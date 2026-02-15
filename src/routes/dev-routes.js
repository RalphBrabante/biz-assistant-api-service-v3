const express = require('express');
const {
  createDevUser,
  inspectDevCache,
} = require('../controllers/dev-controller');

const router = express.Router();

router.post('/users', createDevUser);
router.get('/cache', inspectDevCache);

module.exports = router;
