'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Card, Input, Button } from '@/components/ui';
import { useSchoolHref } from '@/lib/school-path';

interface GuideSection {
  id: string;
  title: string;
  category: string;
  icon: string;
  content: React.ReactNode;
}

export default function AdminGuidePage() {
  const router = useRouter();
  const link = useSchoolHref();
  const [search, setSearch] = useState('');
  
  const GUIDE_SECTIONS: GuideSection[] = [
    {
      id: 'dashboard',
      title: 'Your Admin dashboard',
      category: 'Home Base',
      icon: '◫',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            The Dashboard gives you a complete overview of your school&apos;s daily operations.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>What you&apos;ll find here:</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Key Metrics:</strong> High-level statistics on student enrollment, active staff, and daily attendance.</li>
                <li><strong>Recent Activity:</strong> A feed of the latest updates across the platform.</li>
                <li><strong>System Alerts:</strong> Important notifications requiring admin attention.</li>
                <li><strong>Quick Links:</strong> Fast access to user management, fees, and ticketing.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin'))}>Open Dashboard</Button>
          </div>
        </>
      )
    },
    {
      id: 'users',
      title: 'Manage your users',
      category: 'People',
      icon: '◉',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Need to add or update a user? The User Management section lets you control access for students, teachers, parents, and other staff.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow: Adding a User</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <span>Click Add User</span> <span>→</span> <span>Enter Details</span> <span>→</span> <span>Select Role</span> <span>→</span> <span>Save</span> <span>→</span> <span>Verify Access</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Search and filter the user list by role or status.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Click on a user to view or edit their profile details.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Activate, deactivate, or update roles securely.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/users'))}>Open User Management</Button>
          </div>
        </>
      )
    },
    {
      id: 'student-classes',
      title: 'Keep classes organized.',
      category: 'People',
      icon: '◑',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Manage classroom assignments and group students into sections efficiently.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ View all classes</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Manage divisions</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Assign students</div>
          </div>
          <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
            <strong>What you can do:</strong>
            <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
              <li>Browse class rosters and student details.</li>
              <li>Filter students by grade or section.</li>
              <li>Reassign students between sections to balance class sizes.</li>
            </ul>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/student-classes'))}>Open Student Classes</Button>
          </div>
        </>
      )
    },
    {
      id: 'payments',
      title: 'Keep finances on track.',
      category: 'Finance',
      icon: '₹',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Monitor fee collections, review pending payments, and generate financial reports.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow: Reviewing a Payment</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <span>Search Student</span> <span>→</span> <span>Open Payment Details</span> <span>→</span> <span>Review Status</span> <span>→</span> <span>Update or Issue Receipt</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Filter transactions by status (Paid, Pending, Overdue).</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>View detailed invoice breakdowns.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Record manual offline payments if needed.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/payments'))}>Open Payments & Fees</Button>
          </div>
        </>
      )
    },
    {
      id: 'tickets',
      title: 'Keep issues moving.',
      category: 'Communication',
      icon: '✉',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Manage support requests from students, parents, and teachers efficiently.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ View active tickets</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Reply & resolve</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Filter by priority</div>
          </div>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow: Resolving a Ticket</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <span>Open Ticket</span> <span>→</span> <span>Review Details & Priority</span> <span>→</span> <span>Add Comment</span> <span>→</span> <span>Mark as Resolved</span>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/tickets'))}>Open Tickets</Button>
          </div>
        </>
      )
    },
    {
      id: 'announcements',
      title: 'Broadcast important updates.',
      category: 'Communication',
      icon: '◍',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Keep the entire school informed by publishing announcements.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Draft a new announcement with a clear title and description.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Select the target audience (e.g., all students, specific classes, or teachers).</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Publish immediately or schedule for later.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/announcements'))}>Open Announcements</Button>
          </div>
        </>
      )
    },
    {
      id: 'timetable-builder',
      title: 'Plan the academic year.',
      category: 'Operations',
      icon: '▥',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Use the Timetable Builder to schedule classes, assign teachers, and manage classroom allocation.
          </p>
          <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
            <strong>Key Features:</strong>
            <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
              <li>Avoid scheduling conflicts automatically.</li>
              <li>Assign specific subjects and rooms to teachers.</li>
              <li>Publish finalized timetables for students and staff.</li>
            </ul>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/timetable'))}>Open Timetable Builder</Button>
          </div>
        </>
      )
    },
    {
      id: 'permissions',
      title: 'Control access securely.',
      category: 'System',
      icon: '🔐',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Manage roles and permissions to ensure staff and students only access what they need.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>What you can do:</strong>
            <ul style={{ paddingLeft: 20, margin: 0, color: 'var(--blue)' }}>
              <li>Review current role definitions.</li>
              <li>Adjust access levels for different administrative modules.</li>
              <li>Audit user permissions securely.</li>
            </ul>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/admin/permissions'))}>Open Permissions</Button>
          </div>
        </>
      )
    }
  ];

  const [activeSectionId, setActiveSectionId] = useState(GUIDE_SECTIONS[0].id);

  const filteredSections = GUIDE_SECTIONS.filter((section) => 
    section.title.toLowerCase().includes(search.toLowerCase()) || 
    section.category.toLowerCase().includes(search.toLowerCase()) ||
    section.id.toLowerCase().includes(search.toLowerCase())
  );

  const categories = Array.from(new Set(filteredSections.map(s => s.category)));
  const currentSection = GUIDE_SECTIONS.find(s => s.id === activeSectionId) || filteredSections[0];

  const quickActions = [
    { icon: '◉', label: 'Manage Users', id: 'users' },
    { icon: '◑', label: 'Student Classes', id: 'student-classes' },
    { icon: '₹', label: 'Payments', id: 'payments' },
    { icon: '✉', label: 'Tickets', id: 'tickets' },
    { icon: '◍', label: 'Announcements', id: 'announcements' },
  ];

  return (
    <PortalShell expectedSlug="admin" topbar={{ title: 'Admin Hub', desc: 'Centralized help for managing your EduOS operations.' }}>
      <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40, minHeight: 'calc(100vh - 120px)' }}>
        
        {/* Hero Section */}
        <div style={{ background: 'var(--accent)', borderRadius: 12, padding: '40px 32px', color: 'var(--on-accent)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em' }}>
            Everything you need, right here.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 32, fontSize: 16, opacity: 0.9, fontWeight: 400 }}>
            Manage your school operations, users, classes, finances, and more from one place.
          </p>
          
          <div style={{ width: '100%', maxWidth: 600, position: 'relative' }}>
            <Input 
              type="search" 
              placeholder="What do you want to do?" 
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const newFiltered = GUIDE_SECTIONS.filter(s => s.title.toLowerCase().includes(e.target.value.toLowerCase()) || s.id.toLowerCase().includes(e.target.value.toLowerCase()));
                if (newFiltered.length > 0 && !newFiltered.find(s => s.id === activeSectionId)) {
                  setActiveSectionId(newFiltered[0].id);
                }
              }}
              style={{ width: '100%', textAlign: 'center', padding: '16px 20px', fontSize: 16, borderRadius: 24, background: 'var(--bg)', color: 'var(--text)', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            {quickActions.map(action => (
              <button 
                key={action.id}
                onClick={() => {
                  setSearch('');
                  setActiveSectionId(action.id);
                }}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', 
                  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: 20, color: 'var(--on-accent)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', backdropFilter: 'blur(4px)', transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                onFocus={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                onBlur={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              >
                <span>{action.icon}</span> {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', flex: 1 }}>
          
          {/* Sidebar */}
          <Card pad={false} style={{ width: 280, flex: '1 1 280px', maxWidth: 320, alignSelf: 'flex-start', position: 'sticky', top: 24 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hairline)', fontWeight: 600, fontSize: 14 }}>
              Topics
            </div>
            <div style={{ padding: '12px 8px' }}>
              {categories.length === 0 ? (
                <div style={{ padding: 12, color: 'var(--text-faint)', fontSize: 13 }}>No results found.</div>
              ) : (
                categories.map(category => (
                  <div key={category} style={{ marginBottom: 12 }}>
                    <div style={{ 
                      padding: '4px 12px', fontSize: 11, fontWeight: 700, 
                      textTransform: 'uppercase', color: 'var(--text-faint)', letterSpacing: '0.05em'
                    }}>
                      {category}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {filteredSections.filter(s => s.category === category).map(section => (
                        <button
                          key={section.id}
                          onClick={() => setActiveSectionId(section.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            textAlign: 'left',
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: activeSectionId === section.id ? 'var(--blue-dim)' : 'transparent',
                            color: activeSectionId === section.id ? 'var(--blue)' : 'var(--text-1)',
                            fontWeight: activeSectionId === section.id ? 600 : 400,
                            fontSize: 13,
                            cursor: 'pointer',
                            transition: 'all 0.1s ease',
                          }}
                        >
                          <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{section.icon}</span>
                          {section.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Main Content */}
          <div style={{ flex: '3 1 500px', display: 'flex', flexDirection: 'column', gap: 32 }}>
            {currentSection ? (
              <Card>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--hairline)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    {currentSection.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                      {currentSection.category}
                    </div>
                    <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, fontFamily: 'Newsreader, serif' }}>
                      {currentSection.title}
                    </h2>
                  </div>
                </div>
                
                <div style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-1)' }}>
                  {currentSection.content}
                </div>
              </Card>
            ) : (
              <Card>
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>
                  <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                  <h3 style={{ margin: 0, color: 'var(--text)', marginBottom: 8 }}>No results found</h3>
                  <p style={{ margin: 0, fontSize: 14 }}>Try adjusting your search terms.</p>
                  <Button 
                    variant="soft" 
                    onClick={() => setSearch('')}
                    style={{ marginTop: 20 }}
                  >
                    Clear search
                  </Button>
                </div>
              </Card>
            )}

            {/* Need Help Section */}
            <Card style={{ background: 'var(--panel-bg)', borderColor: 'var(--hairline)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Need advanced support?</h3>
                  <p style={{ margin: 0, marginTop: 4, fontSize: 14.5, color: 'var(--text-2)' }}>Check the audit logs or update platform settings if you&apos;re stuck.</p>
                </div>
                <Button variant="soft" onClick={() => router.push(link('/admin/settings'))}>Open Settings</Button>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </PortalShell>
  );
}
