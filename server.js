const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(bodyParser.json());
app.use(express.static(__dirname));

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ qaList: [], groups: {}, profiles: {} }, null, 2));
}

app.get('/data', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    res.json(data);
});

app.post('/qa', (req, res) => {
    const { question, user } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    data.qaList.push({ question, user, answer: '' });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

app.post('/qa/answer', (req, res) => {
    const { index, answer } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    data.qaList[index].answer = answer;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

app.post('/chat', (req, res) => {
    const { group, message } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!data.groups[group]) data.groups[group] = [];
    data.groups[group].push(message);
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

app.get('/chat/:group', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const group = req.params.group;
    res.json(data.groups[group] || []);
});

app.post('/profile', (req, res) => {
    const { email, username, name, pfp } = req.body;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    data.profiles[email] = { username, name, pfp };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
