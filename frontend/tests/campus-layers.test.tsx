import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CampusLayersDto } from '@/lib/ops-types';
import { CampusLayersPanel, RoomLayerFacts, DepartmentTasks, availableLayers } from '@/components/campus/campus-layers';

/**
 * The campus map's operational panels show only the layers the server sent
 * for this reader, read straight from each module's answer: labs with the
 * practical in session and counts, buses with live status and seats, cover
 * as "X covering for Y", tasks by department, and the gate as counts.
 */
const full: CampusLayersDto = {
  asOf: '2026-10-15T05:00:00.000Z',
  layers: { labs: true, transport: true, cover: true, tasks: true, gate: true, activities: true, greenery: false },
  unavailable: [],
  labs: [
    { labId: 'l1', name: 'Chemistry Lab', facilityId: 'f-lab', practicalNow: { title: 'Titration', subject: 'Chemistry', className: 'Class 9 A', until: null, status: 'IN_PROGRESS' }, openIncidents: 1, lowStock: 2, expiringSoon: 0, calibrationOverdue: 0 },
    { labId: 'l2', name: 'Computer Lab', facilityId: 'f-lab2', practicalNow: null, openIncidents: null, lowStock: null, expiringSoon: null, calibrationOverdue: null },
  ],
  transport: { facilityId: 'f-bay', live: 1, stale: 0, offline: 1, dueSoon: 1, vehicles: [
    { id: 'v1', registrationNo: 'MH12AB1234', type: 'BUS', vehicleStatus: 'ACTIVE', positionStatus: 'LIVE', trips: [{ refNo: 'TR-1', kind: 'AFTERNOON_DROP', status: 'IN_PROGRESS', routeName: 'Route 1', seatsUsed: 28, capacity: 36 }], documentsDue: [{ kind: 'INSURANCE', state: 'EXPIRING', daysLeft: 10 }], checksDue: [], blocked: false },
    { id: 'v2', registrationNo: 'MH12CD5678', type: 'VAN', vehicleStatus: 'ACTIVE', positionStatus: 'OFFLINE', trips: [], documentsDue: [], checksDue: [], blocked: false },
  ] },
  cover: { today: 2, now: [{ facilityId: 'f-g01', room: 'Room G01', className: 'Class 6 A', periodNo: 3, startTime: '10:15', endTime: '11:00', substituteName: 'Ms Rao', absentName: 'Mr Menon', label: 'Ms Rao covering for Mr Menon' }] },
  tasks: { scope: 'ALL', overdue: 3, dueThisWeek: 4, byDepartment: [{ department: 'FINANCE', mapDepartment: 'FINANCE', overdue: 3, dueThisWeek: 1, open: 5 }, { department: 'LABS', mapDepartment: 'ACADEMICS', overdue: 0, dueThisWeek: 3, open: 3 }] },
  gate: { facilityId: 'f-gate', visitorsOnSite: 4, studentsOutOnPass: 2 },
  activities: { available: false, note: 'This module is not installed yet.' },
};

describe('the operations panel on the campus map', () => {
  it('offers only the layers that arrived', () => {
    expect(availableLayers(full)).toEqual(['labs', 'transport', 'cover', 'tasks', 'gate', 'activities']);
    const teacher: CampusLayersDto = { asOf: full.asOf, layers: { labs: true, cover: true, transport: false, gate: false }, unavailable: [], labs: full.labs, cover: full.cover };
    render(<CampusLayersPanel data={teacher} />);
    expect(screen.getByRole('button', { name: /Labs/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Transport/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gate/ })).toBeNull();
  });

  it('renders nothing for a family, who receive no operational layer', () => {
    const { container } = render(<CampusLayersPanel data={{ asOf: full.asOf, layers: { labs: false, transport: false }, unavailable: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows labs, buses, cover, tasks and the gate from the records, and moves to a place', () => {
    const onGo = vi.fn();
    render(<CampusLayersPanel data={full} onGo={onGo} />);
    fireEvent.click(screen.getByRole('button', { name: /Labs/ }));
    expect(screen.getByText(/Practical now: Titration · Class 9 A/)).toBeInTheDocument();
    expect(screen.getByText('1 incident · 2 low')).toBeInTheDocument();
    expect(screen.getByText('not your lab')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Chemistry Lab'));
    expect(onGo).toHaveBeenCalledWith('f-lab');

    fireEvent.click(screen.getByRole('button', { name: /Transport/ }));
    expect(screen.getByText(/28\/36 seats · Due: Insurance/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cover/ }));
    expect(screen.getByText('Ms Rao covering for Mr Menon')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Tasks/ }));
    expect(screen.getByText(/3 overdue · 1 due this week · 5 open/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Gate/ }));
    expect(screen.getByText('4 visitors on site · 2 students out on a pass')).toBeInTheDocument();
    expect(screen.getByText('counts only')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Sports & arts/ }));
    expect(screen.getByText('This module is not installed yet.')).toBeInTheDocument();
  });

  it('puts the cover and lab facts on the selected room, and tasks on its department', () => {
    const { rerender } = render(<RoomLayerFacts data={full} facilityId="f-g01" />);
    expect(screen.getByText('Ms Rao covering for Mr Menon')).toBeInTheDocument();
    rerender(<RoomLayerFacts data={full} facilityId="f-lab" />);
    expect(screen.getByText('Titration · Class 9 A')).toBeInTheDocument();
    rerender(<RoomLayerFacts data={full} facilityId="f-gate" />);
    expect(screen.getByText('Visitors on site')).toBeInTheDocument();
    rerender(<DepartmentTasks data={full} code="ACADEMICS" />);
    expect(screen.getByText('due this week').previousSibling).toHaveTextContent('3');
  });
});
