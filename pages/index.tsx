import { useNavigate } from '@aha-app/builder-core';
import { useEffect } from 'react';

export default function IndexPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/projects');
  }, []);
  return null;
}
