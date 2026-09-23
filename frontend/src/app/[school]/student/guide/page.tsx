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

export default function StudentGuidePage() {
  const router = useRouter();
  const link = useSchoolHref();
  const [search, setSearch] = useState('');
  
  // Wait until mounted to access router/links safely if needed, but useSchoolHref works in render.
  
  const GUIDE_SECTIONS: GuideSection[] = [
    {
      id: 'dashboard',
      title: 'Dashboard Overview',
      category: 'Home Base',
      icon: '◳',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            The Dashboard is your daily starting point. It gives you a quick snapshot of what you need to focus on today.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>What you'll find here:</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Today's Schedule:</strong> See the classes you have coming up today.</li>
                <li><strong>Quick Stats:</strong> Get a snapshot of your attendance, pending assignments, upcoming exams, and fees.</li>
                <li><strong>Recent Announcements:</strong> Stay up to date with the latest updates from your school.</li>
                <li><strong>Quick Links:</strong> Quickly access your assignments, performance, and other frequently used sections.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student'))}>Open Dashboard</Button>
          </div>
        </>
      )
    },
    {
      id: 'timetable',
      title: 'Never miss a class.',
      category: 'Academics',
      icon: '▥',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            The Timetable module shows your complete class schedule.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Open Timetable from the sidebar.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>View your schedule day by day.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>See subject, teacher, time, and room details.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>4</span> <span>Click "Live" (if available) to join online classes.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/timetable'))}>Open Timetable</Button>
          </div>
        </>
      )
    },
    {
      id: 'assignments',
      title: 'From assignment to submission.',
      category: 'Academics',
      icon: '✐',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Keep track of your homework and submit it online.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ View instructions</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Check deadlines</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Submit work</div>
          </div>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span>View Assignment</span> <span>→</span> <span>Read Instructions</span> <span>→</span> <span>Submit Work</span> <span>→</span> <span>View Status</span>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/assignments'))}>Open Assignments</Button>
          </div>
        </>
      )
    },
    {
      id: 'performance',
      title: 'Track your progress.',
      category: 'Academics',
      icon: '◉',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Check your marks, grades, and upcoming exam schedules.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>What you can view:</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Exam Results:</strong> Detailed breakdown of your marks for past exams.</li>
                <li><strong>Upcoming Exams:</strong> See when your next exams are scheduled.</li>
                <li><strong>Overall Performance:</strong> Track how you are doing across subjects.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/performance'))}>Open Performance</Button>
          </div>
        </>
      )
    },
    {
      id: 'attendance',
      title: 'Know where you stand.',
      category: 'Academics',
      icon: '☱',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Keep track of your attendance and ensure you meet the requirements.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ View attendance %</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ See daily status</div>
          </div>
          <div style={{ padding: '12px 16px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fca5a5', fontSize: 13, color: '#b91c1c' }}>
             <strong>Note:</strong> If your monthly attendance falls below 75%, you will see a warning on your dashboard.
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/attendance'))}>Open Attendance</Button>
          </div>
        </>
      )
    },
    {
      id: 'announcements',
      title: 'Stay in the loop.',
      category: 'Campus Life',
      icon: '◍',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Important updates from the school administration and teachers.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Open Announcements from the sidebar.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Click on any announcement to read the full details.</span></div>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-faint)' }}>
            Recent announcements are also pinned to your Dashboard for quick access.
          </p>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/announcements'))}>Open Announcements</Button>
          </div>
        </>
      )
    },
    {
      id: 'library',
      title: 'Your digital library desk.',
      category: 'Campus Life',
      icon: '▢',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Search the catalog, request books, and track the items currently issued to you.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>1. My Checked-Out Books</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                <li>View books currently issued to you, their due dates, and any fines.</li>
                <li>Filter by due date to see what needs to be returned soon.</li>
                <li>Check the status (e.g., <span style={{ color: '#d97706' }}>Due soon</span>, <span style={{ color: '#dc2626' }}>Overdue</span>, <span style={{ color: '#16a34a' }}>Returned</span>).</li>
              </ul>
            </div>
            
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>2. Library Catalogue</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                <li>Search across titles, authors, and categories.</li>
                <li>Filter by <strong>Physical books</strong> or <strong>Digital resources</strong>.</li>
                <li>Request physical copies that are available, or instantly open online digital resources.</li>
              </ul>
            </div>
            
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>3. My Requests</strong>
              <p style={{ marginTop: 8, marginBottom: 0, fontSize: 14 }}>
                Once you request a book, track the librarian's decision here (Pending, Approved, Rejected). Approved books will then show up in your checked-out list.
              </p>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/library'))}>Open Library</Button>
          </div>
        </>
      )
    },
    {
      id: 'transport',
      title: 'Manage your commute.',
      category: 'Campus Life',
      icon: '⛒',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            View your assigned bus route and request places on available school buses.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>My Bus Route</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                <li>View your assigned <strong>Bus Route</strong>, <strong>Vehicle Number</strong>, and <strong>Stop</strong>.</li>
                <li>Check the <strong>Live ETA (A.M.)</strong> for your morning pickup.</li>
                <li>Access contact information for your route's <strong>Driver</strong>.</li>
              </ul>
            </div>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>Asking for a Place</strong>
              <p style={{ marginTop: 8, marginBottom: 8, fontSize: 14 }}>
                If you do not have transport set up, or want to change your route:
              </p>
              <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                <li>Select from available routes running at the moment.</li>
                <li>Choose a specific stop and the direction (Pick-up, Drop, or Both).</li>
                <li>Send the request to the school office. You will only be billed if and when the office grants your place.</li>
                <li>You can withdraw a pending request at any time.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/transport'))}>Open Transport</Button>
          </div>
        </>
      )
    },
    {
      id: 'payments',
      title: 'Keep your fees on track.',
      category: 'Account',
      icon: '₹',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            View your fee status, pending invoices, and payment history.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Open Payments from the sidebar.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Review any pending invoices.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Complete payments online (if enabled).</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>4</span> <span>Download receipts for past payments.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/student/payments'))}>Open Payments</Button>
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
    { icon: '✐', label: 'Assignments', id: 'assignments' },
    { icon: '▥', label: 'Timetable', id: 'timetable' },
    { icon: '☱', label: 'Attendance', id: 'attendance' },
    { icon: '▢', label: 'Library', id: 'library' },
    { icon: '⛒', label: 'Transport', id: 'transport' },
    { icon: '◍', label: 'Announcements', id: 'announcements' },
  ];

  return (
    <PortalShell expectedSlug="student" topbar={{ title: 'Student Hub', desc: 'Everything you need to get the most out of your student portal.' }}>
      <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40, minHeight: 'calc(100vh - 120px)' }}>
        
        {/* Hero Section */}
        <div style={{ background: 'var(--accent)', borderRadius: 12, padding: '40px 32px', color: 'var(--on-accent)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em' }}>
            Everything you need, right here.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 32, fontSize: 16, opacity: 0.9, fontWeight: 400 }}>
            Find your classes, assignments, attendance, exams, and more — all in one place.
          </p>
          
          <div style={{ width: '100%', maxWidth: 600, position: 'relative' }}>
            <Input 
              type="search" 
              placeholder="Search for guides, topics, or features..." 
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
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Still need help?</h3>
                  <p style={{ margin: 0, marginTop: 4, fontSize: 14.5, color: 'var(--text-2)' }}>Find the right section or explore another topic.</p>
                </div>
                <Button variant="soft" onClick={() => router.push(link('/student/tickets'))}>Raise a Ticket</Button>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </PortalShell>
  );
}
