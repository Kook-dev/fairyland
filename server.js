// server.js
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;
const secret = 'fairyland-secret-2025';

// Tạo thư mục nếu chưa có
const videoDir = path.join(__dirname, 'public/videos');
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/videos'),
    filename: (req, file, cb) => {
        const title = req.body.title || 'video';
        const safeName = title
            .trim()
            .replace(/[^a-zA-Z0-9À-ỹ\s-]/g, '') // Chỉ giữ chữ, số, khoảng trắng, dấu gạch ngang
            .replace(/\s+/g, '-') // Thay khoảng trắng bằng -
            .toLowerCase()
            .substring(0, 50); // Giới hạn độ dài
        const filename = `${safeName}.mp4`;
        cb(null, filename);
    }
});
const upload = multer({ storage });

let users = [];
let videos = [];

// Khởi tạo admin
if (!users.some(u => u.username === 'admin')) {
    users.push({ username: 'admin', password: 'admin123', role: 'admin' });
    console.log('Admin: admin / admin123');
}

// === TẢI VIDEO TỪ THƯ MỤC ===
function loadVideosFromDisk() {
    videos = [];
    const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
    files.forEach(filename => {
        const filePath = path.join(videoDir, filename);
        const stats = fs.statSync(filePath);
        const title = filename.replace(/\.mp4$/i, '').replace(/-/g, ' ');
        videos.push({
            title: title.charAt(0).toUpperCase() + title.slice(1),
            filename,
            views: 0,
            likes: 0,
            uploadedAt: stats.mtime.toISOString()
        });
    });
    console.log(`Đã tải ${videos.length} video từ thư mục.`);
}

// Gọi lần đầu khi khởi động
loadVideosFromDisk();

app.use(express.json());
app.use(express.static('public'));

const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username: user.username, role: user.role }, secret, { expiresIn: '1h' });
    res.json({ token });
});

app.get('/api/auth/verify', authMiddleware, (req, res) => res.json(req.user));

app.get('/api/videos', (req, res) => res.json(videos));
app.get('/api/videos/file/:filename', (req, res) => {
    const video = videos.find(v => v.filename === req.params.filename);
    if (!video) return res.status(404).json({ error: 'Not found' });
    res.json(video);
});

app.post('/api/videos/file/:filename/like', (req, res) => {
    const video = videos.find(v => v.filename === req.params.filename);
    if (!video) return res.status(404).json({ error: 'Not found' });
    video.likes = (video.likes || 0) + 1;
    res.json({ likes: video.likes });
});

app.post('/api/videos/file/:filename/view', (req, res) => {
    const video = videos.find(v => v.filename === req.params.filename);
    if (!video) return res.status(404).json({ error: 'Not found' });
    video.views = (video.views || 0) + 1;
    res.json({ views: video.views });
});

app.post('/api/videos', authMiddleware, upload.single('video'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { title } = req.body;
    const filename = req.file.filename;

    // Kiểm tra trùng tên
    if (videos.some(v => v.filename === filename)) {
        fs.unlinkSync(req.file.path); // Xóa file nếu trùng
        return res.status(400).json({ error: 'Tên video đã tồn tại!' });
    }

    videos.push({
        title: title.charAt(0).toUpperCase() + title.slice(1),
        filename,
        views: 0,
        likes: 0,
        uploadedAt: new Date().toISOString()
    });
    res.status(201).json({ message: 'Thêm thành công' });
});

app.put('/api/videos/file/:filename', authMiddleware, upload.single('video'), (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const oldFilename = req.params.filename;
    const video = videos.find(v => v.filename === oldFilename);
    if (!video) return res.status(404).json({ error: 'Not found' });

    const newTitle = req.body.title || video.title;
    const safeName = newTitle
        .trim()
        .replace(/[^a-zA-Z0-9À-ỹ\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .substring(0, 50);
    const newFilename = `${safeName}.mp4`;

    // Cập nhật tiêu đề
    video.title = newTitle.charAt(0).toUpperCase() + newTitle.slice(1);

    // Nếu có file mới → thay thế
    if (req.file) {
        const oldPath = path.join(videoDir, oldFilename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

        const newPath = path.join(videoDir, newFilename);
        if (fs.existsSync(newPath) && newFilename !== oldFilename) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Tên file mới đã tồn tại!' });
        }

        fs.renameSync(req.file.path, newPath);
        video.filename = newFilename;
    } else if (newFilename !== oldFilename) {
        // Chỉ đổi tên file (không upload mới)
        const oldPath = path.join(videoDir, oldFilename);
        const newPath = path.join(videoDir, newFilename);
        if (fs.existsSync(newPath)) {
            return res.status(400).json({ error: 'Tên file đã tồn tại!' });
        }
        fs.renameSync(oldPath, newPath);
        video.filename = newFilename;
    }

    res.json({ message: 'Cập nhật thành công' });
});

app.delete('/api/videos/file/:filename', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const index = videos.findIndex(v => v.filename === req.params.filename);
    if (index === -1) return res.status(404).json({ error: 'Not found' });

    const filePath = path.join(videoDir, videos[index].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    videos.splice(index, 1);
    res.json({ message: 'Xóa thành công' });
});

// app.listen(port, () => {
//     console.log(`Fairyland + Server running at http://localhost:${port}`);
// });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});