import React from 'react';
import { AbsoluteFill } from 'remotion';
import { RoleKey } from '../config';
import { Parchment } from '../components/Brand';
import { CameraKey, Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';
import { RolePlate } from './overlays';

/**
 * 17.6–38.1s — every role. Same six portal captures as the narrated cut; the
 * sentence under each becomes the portal's name and the modules that portal
 * actually has in its sidebar (frontend/src/lib/portals.ts).
 */
const ROLES: { role: RoleKey; src: string; pills: string[]; camera: CameraKey[] }[] = [
  {
    role: 'principal',
    src: 'principal-intelligence.png',
    pills: ['School Intelligence', 'Risk', 'Fee Health'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 360, z: 1.2 }],
  },
  {
    role: 'teacher',
    src: 'teacher-dashboard.png',
    pills: ['Attendance', 'Assignments', 'Exams'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 380, z: 1.2 }],
  },
  {
    role: 'parent',
    src: 'parent-dashboard.png',
    pills: ['Performance', 'Payments', 'Study Help'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 350, z: 1.2 }],
  },
  {
    role: 'student',
    src: 'student-dashboard.png',
    pills: ['Timetable', 'Assignments', 'Performance'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 360, z: 1.2 }],
  },
  {
    role: 'warden',
    src: 'warden-dashboard.png',
    pills: ['Rooms', 'Hostel Students', 'Medical'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 330, z: 1.22 }],
  },
  {
    role: 'librarian',
    src: 'librarian-dashboard.png',
    pills: ['Catalogue', 'Lending', 'Requests'],
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 300, z: 1.24 }],
  },
];

export const RolesText: React.FC = () => (
  <AbsoluteFill>
    <Parchment />
    <ShotSequence
      overlap={16}
      beats={ROLES.map((r, i) => ({
        weight: i === 0 ? 1.1 : 1,
        enter: 'slide-left' as const,
        node: (
          <AbsoluteFill>
            <Shot src={r.src} camera={r.camera} />
            <RolePlate role={r.role} pills={r.pills} kicker={i === 0 ? 'Every role, one ecosystem' : undefined} />
          </AbsoluteFill>
        ),
      }))}
    />
  </AbsoluteFill>
);
