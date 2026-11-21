import { useRef, useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SERVER_ADDRESS_HINT } from './serverAddress';
import type { ServerConnectForm, ServerFormField } from './useServerConnectForm';

/**
 * The address / username / password fields plus the inline message line. Hosts
 * own the surrounding layout and the actions (onboarding puts Connect in its
 * fixed footer; Settings keeps Test + Save under the fields).
 */
export function ServerConnectFields({
  form,
  showName = false,
  onSubmitEditing,
}: {
  form: ServerConnectForm;
  /** Settings shows the name; onboarding names the server after its host. */
  showName?: boolean;
  /** Return key on the last field. */
  onSubmitEditing?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [showPassword, setShowPassword] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const urlPlaceholder = form.type === 'jellyfin' ? 'http://192.168.1.50:8096' : 'http://192.168.1.50:4533';

  return (
    <View>
      {showName ? (
        <Field
          label="NAME"
          field="name"
          form={form}
          placeholder={form.namePlaceholder}
          autoCapitalize="sentences"
          returnKeyType="next"
        />
      ) : null}
      <Field
        label="SERVER ADDRESS"
        field="baseUrl"
        form={form}
        placeholder={urlPlaceholder}
        keyboardType="url"
        autoComplete="off"
        returnKeyType="next"
        onSubmitEditing={() => usernameRef.current?.focus()}
        submitBehavior="submit"
      />
      <Field
        ref={usernameRef}
        label="USERNAME"
        field="username"
        form={form}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />
      <Field
        ref={passwordRef}
        label="PASSWORD"
        field="password"
        form={form}
        placeholder={form.editing ? 'Unchanged' : undefined}
        secureTextEntry={!showPassword}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmitEditing}
        trailing={
          <AppPressable
            feedback="control"
            onPress={() => setShowPassword((shown) => !shown)}
            style={styles.eye}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textTertiary} />
          </AppPressable>
        }
      />
      <View style={styles.messageRow} accessibilityLiveRegion="polite">
        {form.message ? (
          <>
            <Ionicons
              name={form.message.ok ? 'checkmark-circle' : 'alert-circle-outline'}
              size={16}
              color={form.message.ok ? colors.accent : colors.warning}
              style={styles.messageIcon}
            />
            <Text variant="caption" color={form.message.ok ? colors.accentText : colors.warning} style={styles.messageText}>
              {form.message.text}
            </Text>
          </>
        ) : (
          <Text variant="caption" color={colors.textTertiary} style={styles.messageText}>
            {SERVER_ADDRESS_HINT}
          </Text>
        )}
      </View>
    </View>
  );
}

type FieldProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> & {
  label: string;
  field: ServerFormField;
  form: ServerConnectForm;
  trailing?: ReactNode;
  ref?: Ref<TextInput>;
};

function Field({ label, field, form, trailing, ref, ...input }: FieldProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text variant="label" color={colors.textTertiary} style={styles.fieldLabel}>
        {label}
      </Text>
      <View>
        <TextInput
          ref={ref}
          style={[styles.input, trailing ? styles.inputWithTrailing : null]}
          value={form.values[field]}
          onChangeText={(value) => form.setField(field, value)}
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          editable={form.busy === null}
          accessibilityLabel={label.toLowerCase()}
          {...input}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  field: {
    marginTop: spacing.lg,
  },
  fieldLabel: {
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
  },
  inputWithTrailing: {
    paddingRight: 52,
  },
  trailing: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  eye: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: 30,
  },
  messageIcon: {
    marginTop: -1,
  },
  messageText: {
    flex: 1,
  },
}));
