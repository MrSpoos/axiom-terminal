const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;
console.log('PORT env var is:', process.env.PORT);
console.log('Starting server on:', PORT);

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
