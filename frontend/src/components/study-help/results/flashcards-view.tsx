'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { LearnResult } from '@/lib/types';
import { Label, Text, bodyStyle, stack } from './shared';

type Flashcards = Extract<LearnResult, { type: 'flashcards' }>;

/**
 * One card at a time: recall, flip, then say whether you knew it. Cards marked
 * "again" can be reviewed on their own at the end.
 */
export function FlashcardsView({ result }: { result: Flashcards }) {
  const [deck, setDeck] = useState(() => result.cards.map((_, i) => i));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [again, setAgain] = useState<number[]>([]);

  const finished = pos >= deck.length;

  const mark = (knewIt: boolean) => {
    if (!knewIt) setAgain((a) => [...a, deck[pos]]);
    setPos((p) => p + 1);
    setFlipped(false);
  };

  const startWith = (cards: number[]) => {
    setDeck(cards); setPos(0); setFlipped(false); setAgain([]);
  };

  if (finished) {
    return (
      <div style={{ ...stack(), ...bodyStyle }}>
        <p>
          <strong>Deck done.</strong> You knew {deck.length - again.length} of {deck.length}.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {again.length > 0 && (
            <Button small onClick={() => startWith(again)}>Review the {again.length} to go again</Button>
          )}
          <Button small variant="ghost" onClick={() => startWith(result.cards.map((_, i) => i))}>Restart all cards</Button>
        </div>
      </div>
    );
  }

  const card = result.cards[deck[pos]];
  return (
    <div style={{ ...stack(), ...bodyStyle }}>
      <Label>Card {pos + 1} of {deck.length}</Label>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-pressed={flipped}
        aria-label={flipped ? 'Card answer — click to see the front' : 'Card front — click to flip'}
        style={{
          minHeight: 150,
          padding: '22px 20px',
          borderRadius: 16,
          border: '1px solid var(--hairline-2)',
          background: flipped ? 'var(--panel-bg)' : 'var(--card-bg)',
          boxShadow: '0 2px 10px rgba(0,0,0,.05)',
          textAlign: 'center',
          font: 'inherit',
          color: 'var(--text-1)',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 10 }}>
          {flipped ? 'Answer' : 'Front'}
        </div>
        <div style={{ fontSize: flipped ? 15 : 17, fontWeight: flipped ? 400 : 600 }}>
          <Text>{flipped ? card.back : card.front}</Text>
        </div>
      </button>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!flipped ? (
          <Button small onClick={() => setFlipped(true)}>Flip card</Button>
        ) : (
          <>
            <Button small onClick={() => mark(true)}>Got it</Button>
            <Button small variant="ghost" onClick={() => mark(false)}>Again</Button>
          </>
        )}
      </div>
    </div>
  );
}
