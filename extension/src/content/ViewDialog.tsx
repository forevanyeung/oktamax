import { useEffect, useId, useState } from 'react';

import type { FormView } from '../form/schema';
import { ReadOnlyForm } from '../form/ReadOnlyForm';
import type { ViewTarget } from '../views/types';

type State =
  | { status: 'loading' }
  | { status: 'loaded'; view: FormView }
  | { status: 'error'; message: string };

/**
 * Laid out like Okta's own edit dialogs, and like the "View Rule" dialog Okta
 * shows for active group rules: same form, nothing editable, a single Close.
 */
export const ViewDialog = ({ target, onClose }: { target: ViewTarget; onClose: () => void }) => {
  const [state, setState] = useState<State>({ status: 'loading' });
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    target
      .load()
      .then((view) => !cancelled && setState({ status: 'loaded', view }))
      .catch(
        (error: unknown) => !cancelled && setState({ status: 'error', message: String(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const width = state.status === 'loaded' ? (state.view.width ?? 900) : 650;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal aria-labelledby={titleId} style={{ width }}>
        <h2 className="title" id={titleId}>
          {target.title}
        </h2>
        <div className="content">
          {state.status === 'loading' && <p className="hint">Loading…</p>}
          {state.status === 'error' && (
            <div className="error" role="alert">
              Couldn't load this view: {state.message}
            </div>
          )}
          {state.status === 'loaded' && <ReadOnlyForm view={state.view} />}
        </div>
        <div className="buttons">
          <button type="button" className="button-clear" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </>
  );
};
