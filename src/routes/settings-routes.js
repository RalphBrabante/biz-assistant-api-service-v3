const express = require('express');
const { authorize } = require('../middleware/authz');
const {
  getCacheSetting,
  updateCacheSetting,
} = require('../controllers/settings-controller');

const router = express.Router();

router.get('/cache', authorize('settings.update'), getCacheSetting);
router.put('/cache', authorize('settings.update'), updateCacheSetting);

module.exports = router;
