const express = require('express');
const { createDevUser } = require('../controllers/dev-controller');

const router = express.Router();

router.post('/users', createDevUser);

module.exports = router;
