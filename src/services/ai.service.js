const ort  = require('onnxruntime-node');
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');
const logger = require('../config/logger');

let session = null;

const INPUT_SIZE  = 640; // standard YOLO input
const CONF_THRESH = parseFloat(process.env.AI_CONFIDENCE_THRESHOLD) || 0.5;
const IOU_THRESH  = parseFloat(process.env.AI_IOU_THRESHOLD) || 0.4;

const CRACK_CLASSES = [
  'longitudinal_crack',
  'transverse_crack',
  'diagonal_crack',
  'alligator_crack',
  'pothole',
  'spalling',
  'delamination',
  'corrosion',
];

const SEVERITY_MAP = { 0: 'low', 1: 'low', 2: 'medium', 3: 'medium', 4: 'high', 5: 'high', 6: 'critical', 7: 'critical' };

// ─── Load ONNX model once ───────────────────────────────────────────────────
const loadModel = async () => {
  if (session) return session;
  const modelPath = path.resolve(process.env.ONNX_MODEL_PATH || './models/crack_detection.onnx');
  if (!fs.existsSync(modelPath)) {
    logger.warn(`ONNX model not found at ${modelPath}. AI inference will be mocked.`);
    return null;
  }
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  logger.info(`ONNX model loaded from ${modelPath}`);
  return session;
};

// ─── Preprocess image to float32 tensor ────────────────────────────────────
const preprocessImage = async (imageBuffer) => {
  const resized = await sharp(imageBuffer)
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const float32 = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32[i]                             = resized[i * 3]     / 255.0; // R
    float32[i + INPUT_SIZE * INPUT_SIZE]   = resized[i * 3 + 1] / 255.0; // G
    float32[i + 2 * INPUT_SIZE * INPUT_SIZE] = resized[i * 3 + 2] / 255.0; // B
  }
  return new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
};

// ─── Non-Max Suppression ────────────────────────────────────────────────────
const iou = (a, b) => {
  const xi1 = Math.max(a[0], b[0]), yi1 = Math.max(a[1], b[1]);
  const xi2 = Math.min(a[2], b[2]), yi2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
  const aArea = (a[2]-a[0]) * (a[3]-a[1]);
  const bArea = (b[2]-b[0]) * (b[3]-b[1]);
  return inter / (aArea + bArea - inter + 1e-6);
};

const nms = (boxes, iouThresh) => {
  boxes.sort((a, b) => b.confidence - a.confidence);
  const keep = [];
  const suppressed = new Set();
  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (!suppressed.has(j) && iou(boxes[i].bbox, boxes[j].bbox) > iouThresh) {
        suppressed.add(j);
      }
    }
  }
  return keep;
};

// ─── Parse YOLO output (shape: [1, num_det, 5+classes]) ────────────────────
const parseYoloOutput = (outputData, dims, origW, origH) => {
  const [, numDet, numCols] = dims;
  const detections = [];
  const scaleX = origW / INPUT_SIZE;
  const scaleY = origH / INPUT_SIZE;

  for (let i = 0; i < numDet; i++) {
    const offset     = i * numCols;
    const objectness = outputData[offset + 4];
    if (objectness < CONF_THRESH) continue;

    let maxConf = 0, classId = 0;
    for (let c = 0; c < CRACK_CLASSES.length; c++) {
      const conf = outputData[offset + 5 + c] * objectness;
      if (conf > maxConf) { maxConf = conf; classId = c; }
    }
    if (maxConf < CONF_THRESH) continue;

    const cx = outputData[offset]     * scaleX;
    const cy = outputData[offset + 1] * scaleY;
    const w  = outputData[offset + 2] * scaleX;
    const h  = outputData[offset + 3] * scaleY;

    detections.push({
      bbox:       [cx - w/2, cy - h/2, cx + w/2, cy + h/2],
      confidence: maxConf,
      class_id:   classId,
      class_name: CRACK_CLASSES[classId],
      severity:   SEVERITY_MAP[classId] || 'medium',
    });
  }
  return nms(detections, IOU_THRESH);
};

// ─── Mock result for when model file is not available ──────────────────────
const mockResult = () => ({
  detections:   [],
  total_damages: 0,
  health_score: 100,
  risk_level:   'low',
  processing_time_ms: 100,
  recommendations: ['No model file found — place crack_detection.onnx in /models'],
  mock: true,
});

// ─── Main inference function ────────────────────────────────────────────────
const analyzeImage = async (imageBuffer, imageUrl) => {
  const startTime = Date.now();
  try {
    const sess = await loadModel();
    if (!sess) return mockResult();

    const meta = await sharp(imageBuffer).metadata();
    const tensor = await preprocessImage(imageBuffer);

    const feeds   = { [sess.inputNames[0]]: tensor };
    const results = await sess.run(feeds);
    const output  = results[sess.outputNames[0]];

    const detections = parseYoloOutput(output.data, output.dims, meta.width, meta.height);

    // ── Compute health score & risk level
    const totalDamages = detections.length;
    const criticalCount = detections.filter(d => d.severity === 'critical').length;
    const highCount     = detections.filter(d => d.severity === 'high').length;

    let healthScore = 100 - (totalDamages * 5) - (criticalCount * 15) - (highCount * 8);
    healthScore = Math.max(0, Math.min(100, healthScore));

    let riskLevel = 'low';
    if (healthScore < 30 || criticalCount > 0)  riskLevel = 'critical';
    else if (healthScore < 50 || highCount > 2) riskLevel = 'high';
    else if (healthScore < 75)                   riskLevel = 'medium';

    const recommendations = buildRecommendations(detections, riskLevel);

    return {
      detections:       detections.map(d => ({ ...d, image_url: imageUrl })),
      total_damages:    totalDamages,
      health_score:     Math.round(healthScore * 100) / 100,
      risk_level:       riskLevel,
      processing_time_ms: Date.now() - startTime,
      recommendations,
      mock:             false,
    };
  } catch (err) {
    logger.error(`AI inference error: ${err.message}`);
    throw err;
  }
};

const buildRecommendations = (detections, riskLevel) => {
  const recs = [];
  const types = [...new Set(detections.map(d => d.class_name))];

  if (riskLevel === 'critical') recs.push('URGENT: Immediate structural inspection required by a licensed engineer.');
  if (riskLevel === 'high')     recs.push('Schedule professional inspection within 30 days.');
  if (types.includes('alligator_crack')) recs.push('Alligator cracking detected — full pavement rehabilitation may be necessary.');
  if (types.includes('corrosion'))       recs.push('Corrosion found — assess rebar exposure and apply protective coating.');
  if (types.includes('spalling'))        recs.push('Concrete spalling present — patch and seal affected areas promptly.');
  if (types.includes('pothole'))         recs.push('Pothole(s) detected — fill with cold-mix asphalt as temporary repair.');
  if (detections.length === 0)           recs.push('No significant damage detected. Continue routine monitoring.');

  return recs;
};

// ── Aggregate results from multiple images ──────────────────────────────────
const aggregateScanResults = (imageResults) => {
  const allDetections = imageResults.flatMap(r => r.detections);
  const avgHealth     = imageResults.reduce((s, r) => s + r.health_score, 0) / (imageResults.length || 1);

  const riskPriority = { low: 0, medium: 1, high: 2, critical: 3 };
  const worstRisk    = imageResults.reduce(
    (worst, r) => riskPriority[r.risk_level] > riskPriority[worst] ? r.risk_level : worst,
    'low'
  );

  const allRecs = [...new Set(imageResults.flatMap(r => r.recommendations))];

  return {
    total_damages:   allDetections.length,
    health_score:    Math.round(avgHealth * 100) / 100,
    risk_level:      worstRisk,
    detections:      allDetections,
    recommendations: allRecs,
    per_image:       imageResults,
  };
};

module.exports = { analyzeImage, aggregateScanResults, loadModel };