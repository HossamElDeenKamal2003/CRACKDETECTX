const router = require('express').Router();
const ctrl   = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { validate }     = require('../middleware/validate');
const { body }         = require('express-validator');
const rateLimit        = require('express-rate-limit');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts' });

const passwordRules = body('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Must contain uppercase')
  .matches(/[a-z]/).withMessage('Must contain lowercase')
  .matches(/\d/).withMessage('Must contain a digit')
  .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Must contain a special character');

router.post('/register', [
  body('full_name').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('phone').optional().isMobilePhone(),
  body('user_type').optional().isIn(['owner','engineer','company']),
  passwordRules,
  validate,
], ctrl.register);

router.get('/verify-email', ctrl.verifyEmail);

router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
], ctrl.login);

router.post('/verify-2fa',      ctrl.verify2FA);
router.post('/refresh',         ctrl.refreshToken);
router.post('/logout',          ctrl.logout);

router.post('/forgot-password', [body('email').isEmail().normalizeEmail(), validate], ctrl.forgotPassword);
router.post('/reset-password',  [body('token').notEmpty(), passwordRules, validate], ctrl.resetPassword);

router.post('/2fa/setup',   authenticate, ctrl.setup2FA);
router.post('/2fa/enable',  authenticate, [body('code').isLength({ min: 6, max: 6 }), validate], ctrl.enable2FA);

module.exports = router;