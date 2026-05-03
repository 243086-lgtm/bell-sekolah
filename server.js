const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (HTML, CSS, JS)
app.use(express.static(__dirname));
// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database connection
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'bellmaster_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Multer Configuration for Audio Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 4 * 1024 * 1024 }, // 4MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed!'));
        }
    }
});

// ==========================================
// API ROUTES
// ==========================================

// --- Schedules ---
app.get('/api/schedules', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM schedules');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/schedules', async (req, res) => {
    const { id, day, time, name, soundId } = req.body;
    try {
        await pool.query(
            'INSERT INTO schedules (id, day, time, name, soundId) VALUES (?, ?, ?, ?, ?)',
            [id, day, time, name, soundId]
        );
        res.status(201).json({ id, day, time, name, soundId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.put('/api/schedules/:id', async (req, res) => {
    const { id } = req.params;
    const { day, time, name, soundId } = req.body;
    try {
        await pool.query(
            'UPDATE schedules SET day = ?, time = ?, name = ?, soundId = ? WHERE id = ?',
            [day, time, name, soundId, id]
        );
        res.json({ message: 'Schedule updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM schedules WHERE id = ?', [id]);
        res.json({ message: 'Schedule deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- Sounds ---
app.get('/api/sounds', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM custom_sounds');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/sounds', upload.single('soundFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { id, name } = req.body;
    
    if (!name || !id) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'ID and Name are required' });
    }

    try {
        await pool.query(
            'INSERT INTO custom_sounds (id, name, path, original_name) VALUES (?, ?, ?, ?)',
            [id, name, req.file.filename, req.file.originalname]
        );
        
        res.status(201).json({
            id,
            name,
            path: req.file.filename,
            original_name: req.file.originalname,
            dataUrl: `/uploads/${req.file.filename}` // to keep frontend happy
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/sounds/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [sounds] = await pool.query('SELECT path FROM custom_sounds WHERE id = ?', [id]);
        if (sounds.length > 0) {
            const filePath = path.join(__dirname, 'uploads', sounds[0].path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await pool.query('DELETE FROM custom_sounds WHERE id = ?', [id]);
        res.json({ message: 'Sound deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- Settings ---
app.get('/api/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json(settings);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, value, value]
        );
        res.json({ message: 'Setting saved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- Logs ---
app.get('/api/logs', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM logs ORDER BY ts DESC LIMIT 50');
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/logs', async (req, res) => {
    const { message, type, time, date, ts } = req.body;
    try {
        await pool.query(
            'INSERT INTO logs (message, type, time, date, ts) VALUES (?, ?, ?, ?, ?)',
            [message, type, time, date, ts]
        );
        res.status(201).json({ message: 'Log added' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE logs');
        res.json({ message: 'Logs cleared' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database error' });
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
