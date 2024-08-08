require('dotenv').config();  // Load environment variables from .env file
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const AWS = require('aws-sdk');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 5000;  // Use environment variable for port

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI;
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Set up storage with Multer (memory storage for S3)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls'];
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];

    const extname = allowedExtensions.includes(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'));
    }
  }
});

// Route to handle file upload and team generation
app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  // Upload file to S3
  const s3Params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: `${Date.now()}-${req.file.originalname}`,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  };

  try {
    const s3Response = await s3.upload(s3Params).promise();
    const fileUrl = s3Response.Location;

    // Parse Excel file from S3
    const workbook = XLSX.read(await fetch(fileUrl).then(res => res.buffer()), { type: 'buffer' });
    const sheet1 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    const sheet2 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[1]]);
    const sheet3 = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[2]]);

    // Extract names from the sheets
    const names1 = sheet1.map(item => item.Name);
    const names2 = sheet2.map(item => item.Name);
    const names3 = sheet3.map(item => item.Name);

    // Generate random teams
    const generateTeams = (names1, names2, names3) => {
      const teams = [];
      const minLength = Math.min(names1.length, names2.length, names3.length);

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

    // Create PDF
    const doc = new PDFDocument();
    const pdfPath = path.join(__dirname, 'uploads', `${Date.now()}-teams.pdf`);
    const pdfStream = fs.createWriteStream(pdfPath);

    doc.pipe(pdfStream);

    teams.forEach((team, index) => {
      doc.text(`Team ${index + 1}`);
      team.forEach(member => doc.text(member));
      doc.moveDown();
    });

    doc.end();

    pdfStream.on('finish', async () => {
      // Upload PDF to S3
      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfS3Params = {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `${Date.now()}-teams.pdf`,
        Body: pdfBuffer,
        ContentType: 'application/pdf'
      };

      try {
        const pdfS3Response = await s3.upload(pdfS3Params).promise();
        const pdfUrl = pdfS3Response.Location;
        res.json({ pdfUrl });

        // Clean up uploaded files
        fs.unlinkSync(pdfPath);
      } catch (err) {
        console.error('Error uploading PDF to S3:', err);
        res.status(500).send('Error uploading PDF to S3');
      }
    });

    pdfStream.on('error', (err) => {
      console.error(err);
      res.status(500).send('Error generating PDF');
    });
  } catch (err) {
    console.error('Error processing file:', err);
    res.status(500).send('Error processing file');
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

