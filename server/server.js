require('dotenv').config();  // Load environment variables from .env file
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 5000;  // Use environment variable for port

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

// Set up storage with Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

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
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }

  // Parse Excel file
  const workbook = XLSX.readFile(req.file.path);
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

  pdfStream.on('finish', () => {
    res.download(pdfPath, 'teams.pdf', (err) => {
      if (err) {
        console.error(err);
        res.status(500).send('Error generating PDF');
      } else {
        // Clean up uploaded Excel file and generated PDF
        fs.unlinkSync(req.file.path);
        setTimeout(() => fs.unlinkSync(pdfPath), 60000); // Delete PDF after 1 minute
      }
    });
  });

  pdfStream.on('error', (err) => {
    console.error(err);
    res.status(500).send('Error generating PDF');
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
