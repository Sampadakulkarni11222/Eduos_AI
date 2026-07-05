import mongoose from 'mongoose';
import { Profile } from './src/models/profile.model.js';

async function run() {
  await mongoose.connect('mongodb://localhost:27017/school_erp');
  const profiles = await Profile.find().populate('roleId');
  console.log('Profiles:', profiles.map(p => ({ roleKey: p.roleId?.key, name: p.displayName })));
  process.exit(0);
}

run().catch(console.error);
