const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const { bad } = require('../utils/errors');

const TYPES = {
  image: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' },
  document: { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' },
};
// Magic-byte check: the declared mime is client-controlled, the file header is not.
const MAGIC = { '.jpg': [0xff, 0xd8, 0xff], '.png': [0x89, 0x50, 0x4e, 0x47], '.webp': [0x52, 0x49, 0x46, 0x46], '.pdf': [0x25, 0x50, 0x44, 0x46] };

const make = (kind, sub) => {
  const dir = path.join(env.uploadDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  const allowed = TYPES[kind];
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${allowed[file.mimetype]}`),
    }),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => (allowed[file.mimetype] ? cb(null, true) : cb(bad(`Unsupported file type: ${file.mimetype}`))),
  });
};

/** Run after multer: deletes and rejects files whose bytes don't match their extension. */
const verifyMagic = (req, res, next) => {
  const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : req.file ? [req.file] : [];
  for (const f of files) {
    const sig = MAGIC[path.extname(f.filename)];
    const buf = Buffer.alloc(4);
    const fd = fs.openSync(f.path, 'r'); fs.readSync(fd, buf, 0, 4, 0); fs.closeSync(fd);
    if (!sig || !sig.every((b, i) => buf[i] === b)) {
      files.forEach((x) => fs.rmSync(x.path, { force: true }));
      return next(bad('File content does not match its type'));
    }
  }
  next();
};

const publicPath = (file, sub) => `/uploads/${sub}/${file.filename}`;

module.exports = { productUpload: make('image', 'products'), cmsUpload: make('image', 'cms'), docUpload: make('document', 'documents'), verifyMagic, publicPath };
