const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy required for Render and express-rate-limit
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Allowed hostnames
const ALLOWED_HOSTNAMES = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'tiktok.com',
  'www.tiktok.com',
  'vimeo.com',
  'www.vimeo.com',
  'instagram.com',
  'www.instagram.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com'
];

function isValidUrl(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    return ALLOWED_HOSTNAMES.includes(parsedUrl.hostname);
  } catch (e) {
    return false;
  }
}

// POST /api/info
app.post('/api/info', (req, res) => {
  const { url } = req.body;
  
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL' });
  }

  // Use spawn with argument array to prevent command injection
  // Use extractor-args to bypass YouTube bot protection
  const ytdlp = spawn('yt-dlp', [
    '-J', 
    '--extractor-args', 'youtube:player_client=android',
    url
  ]);
  
  ytdlp.on('error', (err) => {
    console.error('Failed to start yt-dlp:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'yt-dlp executable not found or failed to start.' });
    }
  });

  let output = '';
  let errorOutput = '';

  ytdlp.stdout.on('data', (data) => {
    output += data.toString();
  });

  ytdlp.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp error:', errorOutput);
      return res.status(500).json({ error: 'Failed to fetch video information' });
    }

    try {
      const metadata = JSON.parse(output);
      
      // Check duration if it's available and limit it to ~30 mins (1800s)
      if (metadata.duration && metadata.duration > 1800) {
        return res.status(400).json({ error: 'Video is too long. Maximum allowed duration is 30 minutes.' });
      }

      // Filter formats for video/audio combinations
      const formats = (metadata.formats || [])
        .filter(f => f.url && f.ext) // basic filter
        .map(f => ({
          format_id: f.format_id,
          resolution: f.resolution || 'audio only',
          ext: f.ext,
          vcodec: f.vcodec !== 'none' ? f.vcodec : null,
          acodec: f.acodec !== 'none' ? f.acodec : null,
          filesize: f.filesize || f.filesize_approx,
          format_note: f.format_note || ''
        }))
        // Try to filter out messy formats, keeping mostly usable ones
        .filter(f => f.vcodec || f.acodec)
        .sort((a, b) => (b.filesize || 0) - (a.filesize || 0));

      res.json({
        title: metadata.title,
        thumbnail: metadata.thumbnail,
        duration: metadata.duration,
        formats: formats,
        default_filename: metadata._filename || 'video.mp4'
      });
    } catch (e) {
      console.error('Error parsing JSON from yt-dlp:', e);
      res.status(500).json({ error: 'Failed to parse video information' });
    }
  });
});

// GET /api/download
app.get('/api/download', (req, res) => {
  const { url, format } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL' });
  }
  
  if (!format) {
    return res.status(400).json({ error: 'Format is required' });
  }

  // We set a generic filename, as we might not know it here easily without another call
  const filename = `download-${Date.now()}.mp4`; 
  
  // Set headers for download
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');

  // Spawn yt-dlp to stream output directly to stdout
  // -f format
  // -o - streams to stdout
  // --no-part prevents creation of .part files
  const ytdlp = spawn('yt-dlp', [
    '-f', format, 
    '-o', '-', 
    '--no-part', 
    '--extractor-args', 'youtube:player_client=android',
    url
  ]);

  ytdlp.on('error', (err) => {
    console.error('Failed to start yt-dlp:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'yt-dlp executable not found or failed to start.' });
    } else {
      res.end();
    }
  });

  // Stream output directly to response
  ytdlp.stdout.pipe(res);

  let errorOutput = '';
  ytdlp.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.log(`yt-dlp stderr: ${data}`);
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp exited with code ${code}. Error: ${errorOutput}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed' });
      } else {
         res.end();
      }
    }
  });
  
  // Cleanup if client disconnects early
  req.on('close', () => {
    if (ytdlp.pid && !ytdlp.killed) {
      ytdlp.kill('SIGINT');
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
