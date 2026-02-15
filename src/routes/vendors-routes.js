const express = require('express');
const {
  listVendors,
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
} = require('../controllers/vendors-controller');
const { authorize } = require('../middleware/authz');

const router = express.Router();

router.get('/', authorize('vendors.read'), listVendors);
router.post('/', authorize('vendors.create'), createVendor);
router.get('/:id', authorize('vendors.read'), getVendorById);
router.put('/:id', authorize('vendors.update'), updateVendor);
router.patch('/:id', authorize('vendors.update'), updateVendor);
router.delete('/:id', authorize('vendors.delete'), deleteVendor);

module.exports = router;
