import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const upload = multer();

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET = process.env.PINATA_SECRET;

if (!PINATA_API_KEY || !PINATA_SECRET) {
  console.warn('PINATA_API_KEY or PINATA_SECRET not set. Proxy will not work correctly.');
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.post('/api/pin', upload.single('file'), async (req, res) => {
  try {
    const isFileUpload = !!req.file;

    let pinataRes;
    if (isFileUpload) {
      const formData = new FormData();
      formData.append('file', new Blob([req.file.buffer]), req.file.originalname);
      pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET,
        },
        body: formData,
      });
    } else {
      pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET,
        },
        body: JSON.stringify(req.body),
      });
    }

    if (!pinataRes.ok) {
      const text = await pinataRes.text();
      return res.status(500).json({ error: 'Pinata error', details: text });
    }

    const data = await pinataRes.json();
    const cid = data.IpfsHash;
    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

    res.json({ cid, ipfsUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`Pinata proxy listening on port ${PORT}`);
});


