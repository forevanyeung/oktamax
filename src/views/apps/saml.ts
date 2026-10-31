import { checkbox, radio, section, select, table, text, type FormView } from '../../form/schema';
import { get } from '../../okta/api';
import type { App } from '../../okta/types';
import { labelFor } from '../format';
import { usernameFields } from './shared';

const NAME_ID_FORMATS = {
  'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified': 'Unspecified',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress': 'EmailAddress',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:x509SubjectName': 'x509SubjectName',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent': 'Persistent',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient': 'Transient',
};

const AUTHN_CONTEXT_CLASSES = {
  'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport': 'PasswordProtectedTransport',
  'urn:oasis:names:tc:SAML:2.0:ac:classes:Password': 'Password',
  'urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified': 'Unspecified',
  'urn:oasis:names:tc:SAML:2.0:ac:classes:X509': 'X.509 Certificate',
  'urn:oasis:names:tc:SAML:2.0:ac:classes:TLSClient': 'TLS Client',
  'urn:oasis:names:tc:SAML:2.0:ac:classes:Kerberos': 'Kerberos',
  'urn:federation:authentication:windows': 'Integrated Windows Authentication',
};

const ATTRIBUTE_NAME_FORMATS: Record<string, string> = {
  'urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified': 'Unspecified',
  'urn:oasis:names:tc:SAML:2.0:attrname-format:uri': 'URI Reference',
  'urn:oasis:names:tc:SAML:2.0:attrname-format:basic': 'Basic',
};

const GROUP_FILTERS: Record<string, string> = {
  STARTS_WITH: 'Starts with',
  EQUALS: 'Equals',
  CONTAINS: 'Contains',
  REGEX: 'Matches regex',
};

const SIGNED = { true: 'Signed', false: 'Unsigned' };
const YES_NO = { true: 'Yes', false: 'No' };

/** General tab › "SAML Settings" – the "Edit SAML Integration" wizard's Configure SAML step. */
export async function samlSettingsView(app: App): Promise<FormView> {
  const s = app.settings?.signOn ?? {};
  const sameUrls = s.recipient === s.ssoAcsUrl && s.destination === s.ssoAcsUrl;
  const statements = s.attributeStatements ?? [];
  const hookNames = await Promise.all(
    (s.inlineHooks ?? []).map(({ id }) =>
      get<{ name: string }>(`/api/v1/inlineHooks/${id}`).then(
        (h) => h.name,
        () => id,
      ),
    ),
  );

  return {
    sections: [
      section('SAML Settings', [
        text('Single sign-on URL', s.ssoAcsUrl),
        checkbox('Use this for Recipient URL and Destination URL', sameUrls),
        !sameUrls && text('Recipient URL', s.recipient),
        !sameUrls && text('Destination URL', s.destination),
        checkbox('Allow this app to request other SSO URLs', s.allowMultipleAcsEndpoints),
        s.allowMultipleAcsEndpoints &&
          table(
            'Requestable SSO URLs',
            ['URL', 'Index'],
            (s.acsEndpoints ?? []).map((e) => [e.url, e.index]),
          ),
        text('Audience URI (SP Entity ID)', s.audience),
        text('Default RelayState', s.defaultRelayState),
        select('Name ID format', s.subjectNameIdFormat, NAME_ID_FORMATS),
        ...usernameFields(app, 'Application username'),
      ]),
      section('Advanced Settings', [
        radio('Response', s.responseSigned, SIGNED),
        radio('Assertion Signature', s.assertionSigned, SIGNED),
        select('Signature Algorithm', s.signatureAlgorithm, {
          RSA_SHA256: 'RSA-SHA256',
          RSA_SHA1: 'RSA-SHA1',
        }),
        select('Digest Algorithm', s.digestAlgorithm, { SHA256: 'SHA256', SHA1: 'SHA1' }),
        radio('Assertion Encryption', s.assertionEncryption?.enabled ?? false, {
          true: 'Encrypted',
          false: 'Unencrypted',
        }),
        s.assertionEncryption?.enabled &&
          text('Encryption Algorithm', s.assertionEncryption.encryptionAlgorithm),
        s.assertionEncryption?.enabled &&
          text('Key Transport Algorithm', s.assertionEncryption.keyTransportAlgorithm),
        text('Signature Certificate', s.spCertificate?.x5c?.length ? 'Certificate uploaded' : ''),
        checkbox('Enable Single Logout', s.slo?.enabled),
        s.slo?.enabled && text('Single Logout URL', s.slo.logoutUrl),
        s.slo?.enabled && text('SP Issuer', s.slo.issuer ?? s.spIssuer),
        text('Assertion Inline Hook', hookNames.join(', ') || 'None (disabled)'),
        select('Authentication context class', s.authnContextClassRef, AUTHN_CONTEXT_CLASSES),
        radio('Honor Force Authentication', s.honorForceAuthn, YES_NO),
        text('SAML Issuer ID', s.idpIssuer),
      ]),
      section('Attribute Statements', [
        table(
          'Attribute Statements',
          ['Name', 'Name format', 'Value'],
          statements
            .filter((a) => a.type === 'EXPRESSION')
            .map((a) => [
              a.name,
              labelFor(ATTRIBUTE_NAME_FORMATS, a.namespace),
              a.values?.join(', '),
            ]),
        ),
      ]),
      section('Group Attribute Statements', [
        table(
          'Group Attribute Statements',
          ['Name', 'Name format', 'Filter', 'Value'],
          statements
            .filter((a) => a.type === 'GROUP')
            .map((a) => [
              a.name,
              labelFor(ATTRIBUTE_NAME_FORMATS, a.namespace),
              labelFor(GROUP_FILTERS, a.filterType),
              a.filterValue,
            ]),
        ),
      ]),
    ],
    raw: app.settings?.signOn,
  };
}
