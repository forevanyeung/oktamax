import { Button, Callout, CircularProgress, Dialog } from '@okta/odyssey-react-mui';
import { useEffect, useState } from 'react';

import type { FormView } from '../form/schema';
import { ReadOnlyForm } from '../form/ReadOnlyForm';
import type { ViewTarget } from '../views/types';

type State =
  | { status: 'loading' }
  | { status: 'loaded'; view: FormView }
  | { status: 'error'; message: string };

export const ViewDialog = ({ target, onClose }: { target: ViewTarget; onClose: () => void }) => {
  const [state, setState] = useState<State>({ status: 'loading' });

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

  return (
    <Dialog
      isOpen
      title={target.title}
      onClose={onClose}
      // Okta's edit dialogs have Save + Cancel; read-only gets just the secondary button.
      secondaryCallToActionComponent={
        <Button variant="secondary" label="Close" onClick={onClose} />
      }
    >
      {state.status === 'loading' && <CircularProgress ariaLabel="Loading" />}
      {state.status === 'error' && (
        <Callout severity="error" title="Couldn't load this view" text={state.message} />
      )}
      {state.status === 'loaded' && <ReadOnlyForm view={state.view} />}
    </Dialog>
  );
};
