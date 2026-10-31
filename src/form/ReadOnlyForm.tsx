import {
  Accordion,
  Autocomplete,
  Checkbox,
  CheckboxGroup,
  Fieldset,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
} from '@okta/odyssey-react-mui';
import type { ReactElement } from 'react';

import type { Field, FormView } from './schema';

// Read-only inputs are still "controlled", so React wants a change handler.
const noop = () => {};

const ReadOnlyField = ({ field }: { field: Field }): ReactElement => {
  const common = { label: field.label, hint: field.hint, isReadOnly: true, isFullWidth: true };

  switch (field.type) {
    case 'text':
      return <TextField {...common} value={field.value} onChange={noop} />;

    case 'textarea':
      return <TextField {...common} value={field.value} onChange={noop} isMultiline />;

    case 'select':
      return (
        <Select
          {...common}
          value={field.value}
          options={field.options.map((o) => ({ value: o.value, text: o.label }))}
          onChange={noop}
        />
      );

    case 'radio':
      return (
        <RadioGroup {...common} value={field.value} onChange={noop}>
          {field.options.map((o) => (
            <Radio key={o.value} value={o.value} label={o.label} isReadOnly />
          ))}
        </RadioGroup>
      );

    case 'checkbox':
      // Odyssey's Checkbox is inline; consecutive ones would run together on one line.
      return (
        <div>
          <Checkbox
            label={field.label}
            hint={field.hint}
            isChecked={field.checked}
            onChange={noop}
            isReadOnly
          />
        </div>
      );

    case 'checkboxGroup':
      return (
        <CheckboxGroup label={field.label} hint={field.hint} isReadOnly>
          {field.options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              value={o.value}
              isChecked={field.checked.includes(o.value)}
              onChange={noop}
              isReadOnly
            />
          ))}
        </CheckboxGroup>
      );

    case 'tags':
      // Okta's group/user/zone pickers are multi-select autocompletes.
      return (
        <Autocomplete
          {...common}
          hasMultipleChoices
          options={field.values}
          value={field.values}
          onChange={noop}
        />
      );

    case 'table':
      // Okta renders repeatable rows (attribute statements, ...) as rows of inputs.
      return (
        <Fieldset legend={field.label} description={field.hint}>
          {field.rows.length === 0 ? (
            <TextField label={field.columns[0] ?? field.label} value="" isReadOnly />
          ) : (
            field.rows.map((row, rowIndex) => (
              <Stack key={rowIndex} direction="row" spacing={2}>
                {field.columns.map((column, columnIndex) => (
                  <TextField
                    key={column}
                    label={column}
                    value={row[columnIndex] ?? ''}
                    onChange={noop}
                    isReadOnly
                  />
                ))}
              </Stack>
            ))
          )}
        </Fieldset>
      );
  }
};

export const ReadOnlyForm = ({ view }: { view: FormView }) => (
  <Stack spacing={5}>
    {view.sections
      .filter((s) => s.fields.length > 0)
      .map((s, i) => {
        const fields = s.fields.map((f, j) => <ReadOnlyField key={`${f.label}-${j}`} field={f} />);
        return s.title ? (
          <Fieldset key={i} legend={s.title} description={s.description}>
            {fields}
          </Fieldset>
        ) : (
          <Stack key={i} spacing={4}>
            {fields}
          </Stack>
        );
      })}

    {view.raw !== undefined && (
      <Accordion label="API response (JSON)" variant="borderless">
        <pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 400, margin: 0 }}>
          {JSON.stringify(view.raw, null, 2)}
        </pre>
      </Accordion>
    )}
  </Stack>
);
