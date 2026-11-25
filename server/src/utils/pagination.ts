export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function buildPaginationResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number
): PaginationResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
