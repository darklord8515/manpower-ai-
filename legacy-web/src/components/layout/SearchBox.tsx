import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { projects } from '../../data/demo';
import styles from './SearchBox.module.css';

const MAX_RESULTS = 6;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export function SearchBox({ onSelectProject }: { onSelectProject: (code: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const term = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    return projects
      .filter((project) => `${project.name} ${project.code} ${project.emirate}`.toLowerCase().includes(term))
      .slice(0, MAX_RESULTS);
  }, [term]);

  const showPanel = open && term.length > 0;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const select = (code: string) => {
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
    onSelectProject(code);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + results.length) % results.length);
    } else if (event.key === 'Enter' && showPanel) {
      event.preventDefault();
      select(results[activeIndex].code);
    }
  };

  return (
    <div className={styles.root} ref={rootRef} role="search">
      <Search size={16} className={styles.icon} aria-hidden="true" />
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        name="project-search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search projects…"
        aria-label="Search projects by name, code or emirate"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && results.length ? `${listId}-${activeIndex}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className={styles.hint} aria-hidden="true">
        {IS_MAC ? '⌘' : 'Ctrl'}&nbsp;K
      </kbd>

      <div className={styles.panel} hidden={!showPanel}>
        <ul id={listId} role="listbox" aria-label="Matching projects">
          {results.map((project, index) => (
            <li
              key={project.code}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={styles.result}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => select(project.code)}
            >
              <span className={styles.resultName}>{project.name}</span>
              <span className={styles.resultMeta}>
                {project.code}, {project.emirate}
              </span>
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <p className={styles.empty}>No projects match “{query.trim()}”. Try a project name, code or emirate.</p>
        )}
      </div>
    </div>
  );
}
