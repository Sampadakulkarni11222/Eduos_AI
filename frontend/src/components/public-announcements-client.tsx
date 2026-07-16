'use client';
import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export interface Announcement {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
}

const LOCALE_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    title: 'Public Announcements',
    subtitle: 'Stay updated with the latest school circulars and announcements.',
    searchPlaceholder: 'Search announcements...',
    noAnnouncements: 'No matching announcements found.',
    lastUpdated: 'Rendered & cached at:',
    localeLabel: 'Language',
  },
  hi: {
    title: 'सार्वजनिक घोषणाएं',
    subtitle: 'नवीनतम स्कूल परिपत्रों और घोषणाओं के साथ अपडेट रहें।',
    searchPlaceholder: 'घोषणाएं खोजें...',
    noAnnouncements: 'कोई मिलान घोषणा नहीं मिली।',
    lastUpdated: 'रेंडर और कैश्ड:',
    localeLabel: 'भाषा',
  },
  mr: {
    title: 'सार्वजनिक घोषणा',
    subtitle: 'नवीनतम शाळा परिपत्रक आणि घोषणांसह अद्ययावत रहा.',
    searchPlaceholder: 'घोषणा शोधा...',
    noAnnouncements: 'कोणतीही जुळणारी घोषणा आढळली नाही.',
    lastUpdated: 'रेंडर आणि कॅश केलेले:',
    localeLabel: 'भाषा',
  }
};

export function PublicAnnouncementsClient({
  initialAnnouncements,
  renderedAt,
  locale
}: {
  initialAnnouncements: Announcement[];
  renderedAt: string;
  locale: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  const t = LOCALE_TRANSLATIONS[locale] || LOCALE_TRANSLATIONS.en;

  const filtered = initialAnnouncements.filter((a) =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.content.toLowerCase().includes(search.toLowerCase())
  );

  const handleLocaleChange = (newLocale: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('locale', newLocale);
    startTransition(() => {
      router.push(`/public/announcements?${params.toString()}`);
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(circle at 10% 20%, rgb(90, 18, 30) 0%, rgb(30, 5, 10) 90.1%)',
      color: '#fff',
      padding: '40px 20px',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header Section */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: 800,
              margin: 0,
              background: 'linear-gradient(to right, #F2E4CC, #D8B98A)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontFamily: 'Newsreader, serif'
            }}>
              {t.title}
            </h1>
            <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px', margin: '8px 0 0 0' }}>
              {t.subtitle}
            </p>
          </div>

          {/* Locale Switcher Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.6)' }}>{t.localeLabel}:</span>
            <select
              value={locale}
              onChange={(e) => handleLocaleChange(e.target.value)}
              disabled={isPending}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="en" style={{ color: '#000' }}>English</option>
              <option value="hi" style={{ color: '#000' }}>हिन्दी (Hindi)</option>
              <option value="mr" style={{ color: '#000' }}>मराठी (Marathi)</option>
            </select>
          </div>
        </div>

        {/* Dynamic Search Hydration Hole */}
        <div style={{ marginBottom: '24px', position: 'relative' }}>
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '14px 20px',
              background: 'rgba(255, 255, 255, 0.07)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              color: '#fff',
              fontSize: '15px',
              outline: 'none',
              transition: 'all 0.3s ease',
              boxSizing: 'border-box',
              backdropFilter: 'blur(10px)'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'rgba(216, 185, 138, 0.5)';
              e.target.style.boxShadow = '0 0 15px rgba(216, 185, 138, 0.2)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)';
              e.target.style.boxShadow = 'none';
            }}
          />
        </div>

        {/* Announcements List with Glassmorphic design and animations */}
        <div style={{ display: 'grid', gap: '16px' }}>
          {filtered.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              color: 'rgba(255, 255, 255, 0.4)'
            }}>
              {t.noAnnouncements}
            </div>
          ) : (
            filtered.map((a) => (
              <div
                key={a.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '16px',
                  padding: '24px',
                  boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                  backdropFilter: 'blur(8px)',
                  transition: 'transform 0.2s ease, border-color 0.2s ease',
                  cursor: 'default'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = 'rgba(216, 185, 138, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: '12px',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    margin: 0,
                    color: '#F2E4CC'
                  }}>
                    {a.title}
                  </h3>
                  <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    {new Date(a.publishedAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                <p style={{
                  margin: 0,
                  fontSize: '14.5px',
                  color: 'rgba(255, 255, 255, 0.8)',
                  lineHeight: '1.6'
                }}>
                  {a.content}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Cache status footer */}
        <div style={{
          marginTop: '40px',
          textAlign: 'center',
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.4)',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          paddingTop: '20px'
        }}>
          {t.lastUpdated} <span style={{ color: '#D8B98A', fontWeight: 600 }}>{renderedAt}</span>
        </div>
      </div>
    </div>
  );
}
