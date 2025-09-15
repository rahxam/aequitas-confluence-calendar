import styled from 'styled-components';
import { colors, elevation } from '@atlaskit/theme';

export const Row = styled.div`
  button {
    opacity: 0;
    transition: .2s ease all;
    margin-left: 8px;
  }

  &:hover {
    button {
      opacity: 1;
    }
  }
`;

