'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalShell } from '@/components/shell';
import { Card, Input, Button } from '@/components/ui';

export interface GuideSection {
  id: string;
  title: string;
  category: string;
  icon: string;
  content: React.ReactNode;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
}

interface GuideLayoutProps {
  roleSlug: string;
  title: string;
  description: string;
  sections: GuideSection[];
  quickActions: QuickAction[];
  ticketHref: string;
}

export function GuideLayout({ roleSlug, title, description, sections, quickActions, ticketHref }: GuideLayoutProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id || '');

  const filteredSections = sections.filter((section) => 
    section.title.toLowerCase().includes(search.toLowerCase()) || 
    section.category.toLowerCase().includes(search.toLowerCase()) ||
    section.id.toLowerCase().includes(search.toLowerCase())
  );

  const categories = Array.from(new Set(filteredSections.map(s => s.category)));
  const currentSection = sections.find(s => s.id === activeSectionId) || filteredSections[0];

  return (
    <PortalShell expectedSlug={roleSlug} topbar={{ title, desc: description }}>
      <div style={{ width: '100%', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32, paddingBottom: 40, minHeight: 'calc(100vh - 120px)' }}>
        
        {/* Hero Section */}
        <div style={{ background: 'var(--accent)', borderRadius: 12, padding: '40px 32px', color: 'var(--on-accent)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em' }}>
            Everything you need, right here.
          </h1>
          <p style={{ marginTop: 12, marginBottom: 32, fontSize: 16, opacity: 0.9, fontWeight: 400 }}>
            {description}
          </p>
          
          <div style={{ width: '100%', maxWidth: 600, position: 'relative' }}>
            <Input 
              type="search" 
              placeholder="What do you want to do?" 
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                const newFiltered = sections.filter(s => s.title.toLowerCase().includes(e.target.value.toLowerCase()) || s.id.toLowerCase().includes(e.target.value.toLowerCase()));
                if (newFiltered.length > 0 && !newFiltered.find(s => s.id === activeSectionId)) {
                  setActiveSectionId(newFiltered[0].id);
                }
              }}
              className="guide-search-input"
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
                <Button variant="soft" onClick={() => router.push(ticketHref)}>Raise a Ticket</Button>
              </div>
            </Card>
          </div>

        </div>
      </div>
    </PortalShell>
  );
}
