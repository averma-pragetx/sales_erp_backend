require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set in .env'); process.exit(1); }
  await mongoose.connect(uri);
  const collections = await mongoose.connection.db.listCollections({ name: 'leads' }).toArray();
  if (!collections.length) {
    console.log('No "leads" collection found. Nothing to drop.');
  } else {
    await mongoose.connection.db.dropCollection('leads');
    console.log('Dropped "leads" collection.');
  }
  await mongoose.disconnect();
})();
