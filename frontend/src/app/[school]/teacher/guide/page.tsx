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

export default function TeacherGuidePage() {
  const router = useRouter();
  const link = useSchoolHref();
  const [search, setSearch] = useState('');
  
  const GUIDE_SECTIONS: GuideSection[] = [
    {
      id: 'dashboard',
      title: 'Your teaching dashboard',
      category: 'Home Base',
      icon: '◫',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            The Dashboard is your daily starting point. It gives you a quick snapshot of your day ahead.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>What you&apos;ll find here:</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Today&apos;s Classes:</strong> A quick view of your upcoming schedule.</li>
                <li><strong>Pending Tasks:</strong> Overview of assignments to grade or attendance to mark.</li>
                <li><strong>Recent Announcements:</strong> Important updates from school administration.</li>
                <li><strong>Quick Links:</strong> Fast access to classes, timetable, and more.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher'))}>Open Dashboard</Button>
          </div>
        </>
      )
    },
    {
      id: 'classes',
      title: 'View my classes',
      category: 'Teaching',
      icon: '◐',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Access all the classes and subjects you are currently assigned to teach.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>What you can do:</strong>
            <ul style={{ paddingLeft: 20, margin: 0, color: 'var(--blue)' }}>
              <li>View all your assigned sections and subjects.</li>
              <li>Access student lists for each class.</li>
              <li>Navigate quickly to class-specific actions.</li>
            </ul>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/classes'))}>Open My Classes</Button>
          </div>
        </>
      )
    },
    {
      id: 'attendance',
      title: 'Keep attendance on track.',
      category: 'Teaching',
      icon: '☱',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Quickly and efficiently mark student attendance for your classes.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <span>Open Attendance</span> <span>→</span> <span>Select Class</span> <span>→</span> <span>Select Date</span> <span>→</span> <span>Mark Students</span> <span>→</span> <span>Review & Save</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Select the class and date you want to mark.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Mark students as Present, Absent, or other available statuses.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Save your changes. You can view attendance history and edit past records if allowed.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/attendance'))}>Open Attendance</Button>
          </div>
        </>
      )
    },
    {
      id: 'timetable',
      title: 'Know what\'s coming next.',
      category: 'Teaching',
      icon: '▥',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            View your complete teaching schedule for the week.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Open Timetable from the sidebar.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>See today&apos;s classes and your weekly overview.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Find details like subject, class section, time, and room location.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/timetable'))}>Open Timetable</Button>
          </div>
        </>
      )
    },
    {
      id: 'assignments',
      title: 'From assignment to submission.',
      category: 'Teaching',
      icon: '✎',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Create assignments, set deadlines, and grade student submissions.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Create assignments</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Set deadlines</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Review & grade</div>
          </div>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>Workflow</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
              <span>Create Assignment</span> <span>→</span> <span>Add Details & Deadline</span> <span>→</span> <span>Publish</span> <span>→</span> <span>Review Submissions</span> <span>→</span> <span>Grade</span>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/assignments'))}>Open Assignments</Button>
          </div>
        </>
      )
    },
    {
      id: 'exams',
      title: 'Track student progress.',
      category: 'Teaching',
      icon: '◌',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Manage exam marks and evaluate student performance.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: 'var(--panel-bg)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
              <strong>What you can do:</strong>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li><strong>Enter Marks:</strong> Input scores and grades for your subjects.</li>
                <li><strong>Analyze Performance:</strong> View performance reports and charts for your classes.</li>
                <li><strong>Track Progress:</strong> Monitor how individual students and subjects are performing over time.</li>
              </ul>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/exams'))}>Open Exams & Performance</Button>
          </div>
        </>
      )
    },
    {
      id: 'material',
      title: 'Share course materials.',
      category: 'Content',
      icon: '❑',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Upload and share study materials, notes, and resources with your students.
          </p>
          <div style={{ padding: '16px', background: 'var(--blue-dim)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <strong style={{ color: 'var(--blue)' }}>What you can do:</strong>
            <ul style={{ paddingLeft: 20, margin: 0, color: 'var(--blue)' }}>
              <li>Organize resources by class and subject.</li>
              <li>Make documents readily available for student access.</li>
            </ul>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/material'))}>Open Course Material</Button>
          </div>
        </>
      )
    },
    {
      id: 'announcements',
      title: 'Stay connected with announcements.',
      category: 'Communication',
      icon: '◍',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Keep up with school updates or post your own announcements to your classes.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>1</span> <span>Open Announcements to view the latest messages.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>2</span> <span>Read important information from the school administration.</span></div>
            <div style={{ display: 'flex', gap: 12 }}><span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--blue-dim)', color: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>3</span> <span>Post updates and notices for your students.</span></div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/announcements'))}>Open Announcements</Button>
          </div>
        </>
      )
    },
    {
      id: 'tickets',
      title: 'Manage queries and support.',
      category: 'Communication',
      icon: '✉',
      content: (
        <>
          <p style={{ marginBottom: 16 }}>
            Handle queries from parents or raise issues with school administration.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ View parent queries</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Reply to tickets</div>
             <div style={{ padding: '6px 12px', background: 'var(--panel-bg)', borderRadius: 20, fontSize: 13, border: '1px solid var(--hairline)' }}>✓ Get support</div>
          </div>
          <div style={{ marginTop: 20 }}>
            <Button variant="soft" onClick={() => router.push(link('/teacher/tickets'))}>Open Parent Queries</Button>
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
    { icon: '☱', label: 'Attendance', id: 'attendance' },
    { icon: '✎', label: 'Assignments', id: 'assignments' },
    { icon: '▥', label: 'Timetable', id: 'timetable' },
    { icon: '◐', label: 'Classes', id: 'classes' },
    { icon: '◌', label: 'Exams', id: 'exams' },
    { icon: '✉', label: 'Tickets', id: 'tickets' },
  ];

  return (
    <PortalShell expectedSlug="teacher" topbar={{ title: 'Teacher Hub', desc: 'Everything you need to run your classes smoothly.' }}>
      <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40, minHeight: 'calc(100vh - 120px)' }}>
        
        {/* Hero Section */}
        <div style={{ background: 'var(--accent)', borderRadius: 12, padding: '40px 32px', color: 'var(--on-accent)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em' }}>
            Everything you need, right here.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 32, fontSize: 16, opacity: 0.9, fontWeight: 400 }}>
            Plan your classes, manage attendance, review assignments, and keep your students on track.
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
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Still need help?</h3>
                  <p style={{ margin: 0, marginTop: 4, fontSize: 14.5, color: 'var(--text-2)' }}>Check with the school administration or raise a support ticket.</p>
                </div>
                <Button variant="soft" onClick={() => router.push(link('/teacher/tickets'))}>Raise a Ticket</Button>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </PortalShell>
  );
}
