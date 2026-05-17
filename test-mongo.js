const { MongoClient } = require('mongodb');
const uri = 'mongodb+srv://bharathraj95317_db_user:bharathraj%402006@datgaurdian.865cvpr.mongodb.net/?appName=datgaurdian';
console.log('Connecting...');
const client = new MongoClient(uri, { tls: true, family: 4 });
client.connect().then(() => {
    console.log('Connected successfully!');
    client.close();
}).catch(err => {
    console.error('Connection failed:');
    console.error(err);
});
