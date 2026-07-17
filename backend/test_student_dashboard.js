import mongoose from 'mongoose';
import dns from 'dns';
import { getStudentDashboard } from './src/modules/dashboard/dashboard.service.js';
import { Profile } from './src/models/profile.model.js';
import { Student } from './src/models/student.model.js';
import { Enrollment } from './src/models/student.model.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);

const ATLAS_URI = 'mongodb+srv://kulkarnisampada07_db_user:bPKMqeW8OWkoE6eQ@cluster0.alhw4up.mongodb.net/school_erp?appName=Cluster0';

async function test() {
  console.log('Connecting to Atlas DB...');
  await mongoose.connect(ATLAS_URI);
  
  console.log('Searching for Student 1 Profile...');
  const profile = await Profile.findOne({ displayName: /Aarav Sharma/ });
  if (!profile) {
    console.log('Student Aarav Sharma profile NOT FOUND!');
    await mongoose.disconnect();
    return;
  }
  
  console.log('Profile found:', profile);
  
  console.log('Searching for Student document...');
  const student = await Student.findOne({ profileId: profile._id });
  console.log('Student document:', student);
  
  console.log('Searching for active enrollment...');
  const enrollment = await Enrollment.findOne({ studentId: student?._id, status: 'ACTIVE' });
  console.log('Enrollment document:', enrollment);

  console.log('Calling getStudentDashboard...');
  const dashboardData = await getStudentDashboard(profile._id);
  console.log('Dashboard Data:', JSON.stringify(dashboardData, null, 2));

  await mongoose.disconnect();
}

test().catch(console.error);
