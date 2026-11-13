import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PixReceiptComponent } from './pix-receipt';

describe('PixReceiptComponent', () => {
  let component: PixReceiptComponent;
  let fixture: ComponentFixture<PixReceiptComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PixReceiptComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PixReceiptComponent);
    fixture.componentRef.setInput('nome', 'Maria Silva');
    fixture.componentRef.setInput('valor', 150);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render recipient name', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Maria Silva');
  });
});
