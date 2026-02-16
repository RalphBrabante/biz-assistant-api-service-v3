const fs = require('fs');
const path = require('path');
const multer = require('multer');

const expenseUploadDir = path.join(process.cwd(), 'uploads', 'expenses');
fs.mkdirSync(expenseUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(expenseUploadDir, { recursive: true });
    cb(null, expenseUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext || '.jpg';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `expense-${unique}${safeExt}`);
  },
});

function imageOnlyFilter(_req, file, cb) {
  if (!file || !file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
    cb(new Error('Only image files are allowed for expense file uploads.'));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: imageOnlyFilter,
});

const uploadExpenseImage = upload.single('file');

function csvOnlyFilter(_req, file, cb) {
  const name = String(file?.originalname || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const isCsvName = name.endsWith('.csv');
  const isCsvMime =
    mime.includes('csv') ||
    mime === 'text/plain' ||
    mime === 'application/vnd.ms-excel';

  if (!isCsvName && !isCsvMime) {
    cb(new Error('Only CSV files are allowed for import.'));
    return;
  }
  cb(null, true);
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: csvOnlyFilter,
});

const uploadImportCsv = importUpload.single('file');

module.exports = {
  uploadExpenseImage,
  uploadImportCsv,
};
