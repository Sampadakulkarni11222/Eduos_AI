import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ROLE_THEME, RoleKey } from '../config';
import { Parchment } from '../components/Brand';
import { Caption } from '../components/Caption';
import { CameraKey, Shot } from '../components/Shot';
import { ShotSequence } from '../components/ShotSequence';

/**
 * 18–40s — every role, one ecosystem. Each portal in its own sidebar colour;
 * each line under a role is that screen's own subtitle in the app.
 */
const ROLES: { role: RoleKey; src: string; line: string; camera: CameraKey[] }[] = [
  {
    role: 'principal',
    src: 'principal-intelligence.png',
    line: 'How the school is doing today, and where to look first.',
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 360, z: 1.2 }],
  },
  {
    role: 'teacher',
    src: 'teacher-dashboard.png',
    line: 'Your teaching day at a glance.',
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 380, z: 1.2 }],
  },
  {
    role: 'parent',
    src: 'parent-dashboard.png',
    line: "Your family's school life in one place.",
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 350, z: 1.2 }],
  },
  {
    role: 'student',
    src: 'student-dashboard.png',
    line: 'Your school day at a glance.',
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 360, z: 1.2 }],
  },
  {
    role: 'warden',
    src: 'warden-dashboard.png',
    line: 'Hostel facilities, student welfare and room allocations.',
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 330, z: 1.22 }],
  },
  {
    role: 'librarian',
    src: 'librarian-dashboard.png',
    line: 'Lending catalogue and student activity tracking.',
    camera: [{ at: 0, x: 960, y: 540, z: 1 }, { at: 1, x: 880, y: 300, z: 1.24 }],
  },
];

export const Roles: React.FC = () => (
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
            <Caption
              eyebrow={i === 0 ? 'Every role, one ecosystem' : ROLE_THEME[r.role].portal}
              title={ROLE_THEME[r.role].label}
              sub={r.line}
              accent={ROLE_THEME[r.role].accent}
              from={0.08}
              to={0.97}
            />
          </AbsoluteFill>
        ),
      }))}
    />
  </AbsoluteFill>
);
