const express = require('express');
const {
  login,
  forgotPassword,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
} = require('../controllers/auth-controller');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/request-email-verification', requestEmailVerification);
router.post('/verify-email', verifyEmail);

module.exports = router;
