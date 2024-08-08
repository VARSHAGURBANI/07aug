// pages/api/upload.js
import AWS from 'aws-sdk';
import multer from 'multer';
import multerS3 from 'multer-s3';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { Buffer } from 'buffer';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET,
    acl: 'public-read',
    key: function (req, file, cb) {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls'];
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    const extname = allowedExtensions.includes(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = allowedMimeTypes.includes(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  },
});

export default function handler(req, res) {
  console.log('Received request method:', req.method);

  if (req.method === 'POST') {
    console.log('Processing POST request...');
    upload.single('file')(req, res, async (err) => {
      if (err) {
        console.error('Error during file upload:', err);
        return res.status(400).send(`Error: ${err.message}`);
      }

      console.log('File uploaded:', req.file);

      if (!req.file) {
        return res.status(400).send('No file uploaded');
      }

      const fileUrl = req.file.location;
      console.log('File URL:', fileUrl);

      try {
        const response = await fetch(fileUrl);
        const buffer = await response.buffer();
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet1 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const sheet2 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[1]]);
        const sheet3 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[2]]);

        const names1 = sheet1.map((item) => item.Name);
        const names2 = sheet2.map((item) => item.Name);
        const names3 = sheet3.map((item) => item.Name);

        console.log('Names from sheet 1:', names1);
        console.log('Names from sheet 2:', names2);
        console.log('Names from sheet 3:', names3);

        const generateTeams = (names1, names2, names3) => {
          const teams = [];

          while (names1.length >= 3 && names2.length >= 1 && names3.length >= 1) {
            const team = [];
            for (let i = 0; i < 3; i++) {
              const randomIndex = Math.floor(Math.random() * names1.length);
              team.push(names1.splice(randomIndex, 1)[0]);
            }
            team.push(names2.splice(Math.floor(Math.random() * names2.length), 1)[0]);
            team.push(names3.splice(Math.floor(Math.random() * names3.length), 1)[0]);
            teams.push(team);
          }

          return teams;
        };

        const teams = generateTeams(names1, names2, names3);
        console.log('Generated teams:', teams);

        const doc = new PDFDocument();
        const pdfBuffer = await new Promise((resolve, reject) => {
          const buffers = [];
          doc.on('data', buffers.push.bind(buffers));
          doc.on('end', () => resolve(Buffer.concat(buffers)));
          doc.pipe(fs.createWriteStream('/dev/null'));
          teams.forEach((team, index) => {
            doc.text(`Team ${index + 1}`);
            team.forEach((member) => doc.text(member));
            doc.moveDown();
          });
          doc.end();
        });

        const pdfS3Params = {
          Bucket: process.env.AWS_S3_BUCKET,
          Key: `${Date.now()}-teams.pdf`,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        };

        const pdfS3Response = await s3.upload(pdfS3Params).promise();
        const pdfUrl = pdfS3Response.Location;

        console.log('PDF URL:', pdfUrl);

        res.json({ pdfUrl });
      } catch (err) {
        console.error('Error processing file:', err);
        res.status(500).send('Error processing file');
      }
    });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
