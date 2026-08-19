import { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={wide ? 'modal modal--wide' : 'modal'} role="dialog" aria-label={title}>
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="btn btn--link" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
