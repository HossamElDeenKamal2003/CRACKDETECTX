const router = require('express').Router();
const ctrl   = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');
const { uploadAvatar } = require('../config/cloudinary');

router.use(authenticate);

router.get('/me',            ctrl.getProfile);
router.put('/me',            ctrl.updateProfile);
router.put('/me/avatar',     uploadAvatar.single('avatar'), ctrl.updateAvatar);
router.put('/me/notifications', ctrl.updateNotificationPrefs);
router.put('/me/password',   ctrl.changePassword);
router.delete('/me',         ctrl.deleteAccount);
router.get('/me/sessions',   ctrl.getActiveSessions);
router.delete('/me/sessions/:sessionId', ctrl.revokeSession);

module.exports = router;