import { PublicAnnouncementsClient } from '@/components/public-announcements-client';

export const revalidate = 10; // ISR cache revalidation every 10 seconds

// Simple server-side content dictionary to translate announcement snippets
function translateAnnouncements(announcements: any[], locale: string) {
  if (locale === 'en') return announcements;
  
  const dictionary: Record<string, Record<string, string>> = {
    hi: {
      'Welcome to Oakridge': 'Oakridge में आपका स्वागत है',
      'Parent-Teacher Meeting': 'अभिभावक-शिक्षक बैठक',
      'Final Exams Schedule': 'वार्षिक परीक्षा समय-सारणी',
      'Annual Sports Day': 'वार्षिक खेल दिवस',
      'Notice': 'सूचना',
      'Holiday': 'छुट्टी',
      'Friday': 'शुक्रवार',
      'School': 'स्कूल',
      'all classes': 'सभी कक्षाएं',
      'scheduled': 'निर्धारित',
      'important': 'महत्वपूर्ण'
    },
    mr: {
      'Welcome to Oakridge': 'Oakridge मध्ये आपले स्वागत आहे',

      'Parent-Teacher Meeting': 'पालक-शिक्षक सभा',
      'Final Exams Schedule': 'वार्षिक परीक्षा वेळापत्रक',
      'Annual Sports Day': 'वार्षिक क्रीडा दिन',
      'Notice': 'सूचना',
      'Holiday': 'सुट्टी',
      'Friday': 'शुक्रवार',
      'School': 'शाळा',
      'all classes': 'सर्व वर्ग',
      'scheduled': 'नियोजित',
      'important': 'महत्त्वाचे'
    }
  };

  const dict = dictionary[locale];
  if (!dict) return announcements;

  return announcements.map((a) => {
    let title = a.title;
    let content = a.content;
    
    // Simple replacement translation to prove server-side key differentiation
    Object.entries(dict).forEach(([enWord, transWord]) => {
      const regex = new RegExp(enWord, 'gi');
      title = title.replace(regex, transWord);
      content = content.replace(regex, transWord);
    });

    return { ...a, title, content };
  });
}

export default async function PublicAnnouncementsPage({
  searchParams,
}: {
  // Next 15 made searchParams a promise; it is awaited rather than read
  // directly, which is the only change this upgrade needed in app code.
  searchParams: Promise<{ locale?: string }>;
}) {
  const locale = (await searchParams).locale || 'en';
  const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

  let rawAnnouncements: any[] = [];
  try {
    const res = await fetch(`${backendUrl}/api/v1/announcements`, {
      next: { revalidate: 10 } // leverage Next.js fetch cache alongside route ISR
    });
    if (res.ok) {
      const body = await res.json();
      rawAnnouncements = body.data || body;
    }
  } catch (err) {
    console.error('Failed to fetch announcements on server:', err);
    // Fallback static data if API is down so page rendering doesn't crash
    rawAnnouncements = [
      {
        id: '1',
        title: 'Welcome to Oakridge Notice Board',
        content: 'Welcome to the Oakridge Academy announcements portal. This is a fallback notice.',

        publishedAt: new Date().toISOString()
      }
    ];
  }

  // Server-side cache variation logic:
  // Render announcements based on the negotiated locale
  const announcements = translateAnnouncements(rawAnnouncements, locale);
  const renderedAt = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <PublicAnnouncementsClient
      initialAnnouncements={announcements}
      renderedAt={renderedAt}
      locale={locale}
    />
  );
}
