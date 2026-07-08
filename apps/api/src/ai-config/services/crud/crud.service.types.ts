export interface ICrudService<T, CreateDto, UpdateDto> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(data: CreateDto): Promise<T>;
  update(id: string, data: UpdateDto): Promise<T | null>;
  remove(id: string): Promise<void>;
}
