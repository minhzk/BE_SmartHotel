import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

// Load environment variables
config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'minhzk';

async function resetRoomAvailabilityCollection() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Kiểm tra xem collection có tồn tại không
    const collections = await db
      .listCollections({ name: 'roomavailabilities' })
      .toArray();
    if (collections.length > 0) {
      // Xóa collection cũ
      console.log('Dropping old collection...');
      await db.collection('roomavailabilities').drop();
      console.log('Collection dropped successfully');
    }

    // Tạo collection mới với schema và indexes mới
    console.log('Creating new collection with updated schema...');
    await db.createCollection('roomavailabilities');

    // Tạo các indexes mới
    await db
      .collection('roomavailabilities')
      .createIndex({ room_id: 1, start_date: 1, end_date: 1 });
    await db
      .collection('roomavailabilities')
      .createIndex({ room_id: 1, start_date: 1 });
    await db
      .collection('roomavailabilities')
      .createIndex({ room_id: 1, end_date: 1 });

    console.log('Indexes created successfully');
    console.log('Migration completed!');
  } catch (error) {
    console.error('Error during migration:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

resetRoomAvailabilityCollection()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
