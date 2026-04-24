const Bull = require('bull');
const logger = require('./logger');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
};

const scanQueue = new Bull('scan-processing', { redis: redisConfig });
const emailQueue = new Bull('email-sending',    { redis: redisConfig });
const reportQueue = new Bull('report-generation', { redis: redisConfig });

scanQueue.on('failed',    (job, err) => logger.error(`Scan job ${job.id} failed: ${err.message}`));
scanQueue.on('completed', (job)      => logger.info(`Scan job ${job.id} completed`));
emailQueue.on('failed',   (job, err) => logger.error(`Email job ${job.id} failed: ${err.message}`));

module.exports = { scanQueue, emailQueue, reportQueue };