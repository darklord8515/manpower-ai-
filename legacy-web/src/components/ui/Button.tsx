import type { ButtonHTMLAttributes, Ref } from 'react';
import styles from './Button.module.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={[styles.button, styles[variant], className].filter(Boolean).join(' ')} {...props} />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ className, type = 'button', ...props }: IconButtonProps) {
  return <button type={type} className={[styles.icon, className].filter(Boolean).join(' ')} {...props} />;
}
