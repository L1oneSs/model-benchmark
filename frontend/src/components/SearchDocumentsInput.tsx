import { Textarea } from './ui/textarea';
import { Button } from './ui/button';
import { useState } from 'react';

export interface SearchDocumentInput {
  letter: string;
  title: string;
  text: string;
}

export interface SearchInput {
  query: string;
  documents: SearchDocumentInput[];
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const DOCUMENT_LIMIT = 250;
const DEFAULT_TITLES = ['TensorFlow.js backends', 'Gemini Nano in Chrome', 'Server-side APIs'];

export function initialSearchInput(value: string): SearchInput {
  return {
    query: value.match(/^Query:\s*(.*)/)?.[1] ?? '',
    documents: (value.split('Documents:')[1] ?? '').split('\n')
      .map(line => line.trim()).filter(Boolean).slice(0, LETTERS.length)
      .map((line, index) => ({ letter: LETTERS[index], title: DEFAULT_TITLES[index] ?? '', text: line.replace(/^[A-Z][.)]\s*/, '').slice(0, DOCUMENT_LIMIT) })),
  };
}

export function serializeSearchInput(value: SearchInput): string {
  if (!value.query.trim()) throw new Error('Введите поисковый запрос');
  if (!value.documents.length || value.documents.some(document => !document.text.trim())) {
    throw new Error('Заполните текст каждого документа');
  }
  const singleLine = (text: string) => text.trim().replace(/\s+/g, ' ');
  return `Query: ${singleLine(value.query)}\n\nDocuments:\n` + value.documents.map(document =>
    `${document.letter}. ${document.title.trim() ? `${singleLine(document.title)}: ` : ''}${singleLine(document.text)}`,
  ).join('\n');
}

export function SearchDocumentsInput({ value, onChange, disabled }: {
  value: SearchInput;
  onChange: (value: SearchInput) => void;
  disabled: boolean;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const addDocument = () => {
    const letter = LETTERS.find(candidate => !value.documents.some(document => document.letter === candidate));
    if (!letter) return;
    onChange({ ...value, documents: [...value.documents, { letter, title: '', text: '' }] });
    setOpened(previous => [...previous, letter]);
  };
  const removeDocument = (letter: string) => {
    onChange({ ...value, documents: value.documents.filter(document => document.letter !== letter) });
    setOpened(previous => previous.filter(candidate => candidate !== letter));
  };
  const updateDocument = (index: number, change: Partial<SearchDocumentInput>) => {
    onChange({ ...value, documents: value.documents.map((document, position) =>
      position === index ? { ...document, ...change } : document) });
  };

  return (
    <div className="search-input">
      <label className="search-input__field">
        <span>Поисковый запрос</span>
        <input value={value.query} onChange={event => onChange({ ...value, query: event.target.value })}
          placeholder="Что нужно найти в документах?" disabled={disabled} />
      </label>
      <div className="search-input__heading">
        <span>Документы · {value.documents.length} / 5</span>
        <Button variant="outline" type="button" className="search-input__add" disabled={disabled || value.documents.length >= LETTERS.length}
          onClick={addDocument}
          aria-label="Добавить документ" title={value.documents.length >= LETTERS.length ? 'Можно добавить не более 5 документов' : 'Добавить документ'}>
          <span aria-hidden="true">+</span> Добавить документ
        </Button>
      </div>
      {value.documents.map((document, index) => (
        <div className="search-input__document" key={document.letter}>
          <details open={opened.includes(document.letter)} onToggle={event => {
            const isOpen = event.currentTarget.open;
            setOpened(previous => isOpen
              ? previous.includes(document.letter) ? previous : [...previous, document.letter]
              : previous.filter(letter => letter !== document.letter));
          }}>
            <summary>
              <span className="search-input__letter">{document.letter}</span>
              <span className="search-input__title">{document.title.trim() || `Документ ${document.letter}`}</span>
              <span className="search-input__counter">{document.text.length} / {DOCUMENT_LIMIT}</span>
              <span className="search-input__chevron" aria-hidden="true">⌄</span>
            </summary>
            <fieldset className="search-input__document-fields" disabled={disabled}>
          <label className="search-input__field">
            <span>Название</span>
            <input value={document.title} maxLength={250} placeholder={`Название документа ${document.letter}`}
              onChange={event => updateDocument(index, { title: event.target.value })} />
          </label>
          <label className="search-input__field">
            <span>Текст документа</span>
            <Textarea value={document.text} maxLength={DOCUMENT_LIMIT} rows={3}
              placeholder="Введите текст документа"
              onChange={event => updateDocument(index, { text: event.target.value.slice(0, DOCUMENT_LIMIT) })} />
          </label>
          <span className="search-input__counter">{document.text.length} / {DOCUMENT_LIMIT}</span>
            </fieldset>
          </details>
          <Button variant="outline" type="button" className="search-input__remove" disabled={disabled}
            onClick={() => removeDocument(document.letter)} aria-label={`Удалить документ ${document.letter}`}
            title={`Удалить документ ${document.letter}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
            </svg>
          </Button>
        </div>
      ))}
    </div>
  );
}
