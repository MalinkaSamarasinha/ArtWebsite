// Run the site on your own computer:  npm start
const app = require('./lib/app');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
