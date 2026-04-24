const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for scan images
const scanStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'crackdetectx/scans',
    allowed_formats: ['jpg', 'jpeg', 'png', 'heic'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  },
});

// Storage for profile avatars
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'crackdetectx/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    transformation: [{ width: 400, height: 400, crop: 'fill' }],
  },
});

// Storage for building images
const buildingStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'crackdetectx/buildings',
    allowed_formats: ['jpg', 'jpeg', 'png'],
    transformation: [{ quality: 'auto' }],
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/jpg'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, HEIC allowed.'), false);
  }
};

const uploadScan     = multer({ storage: scanStorage,     fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadAvatar   = multer({ storage: avatarStorage,   fileFilter, limits: { fileSize: 5  * 1024 * 1024 } });
const uploadBuilding = multer({ storage: buildingStorage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

const deleteImage = async (publicId) => {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary delete error:', err);
  }
};

module.exports = { cloudinary, uploadScan, uploadAvatar, uploadBuilding, deleteImage };