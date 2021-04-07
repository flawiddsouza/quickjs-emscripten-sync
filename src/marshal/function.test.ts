import { getQuickJS, QuickJSHandle } from "quickjs-emscripten";
import marshalFunction from "./function";

it("normal func", async () => {
  const vm = (await getQuickJS()).createVm();
  const eqh = vm.unwrapResult(vm.evalCode(`Object.is`));
  const eq = (a: QuickJSHandle | undefined, b: QuickJSHandle) =>
    !!vm.dump(
      vm.unwrapResult(vm.callFunction(eqh, vm.undefined, a ?? vm.undefined, b))
    );

  const marshal = jest.fn(v =>
    typeof v === "string"
      ? vm.newString(v)
      : typeof v === "number"
      ? vm.newNumber(v)
      : vm.null
  );
  const unmarshal = jest.fn(v => (eq(v, vm.global) ? undefined : vm.dump(v)));
  const preMarshal = jest.fn();
  const innerfn = jest.fn((..._args: any[]) => "hoge");
  const fn = (...args: any[]) => innerfn(...args);

  const handle = marshalFunction(vm, fn, marshal, unmarshal, preMarshal);
  if (!handle) throw new Error("handle is undefined");

  expect(marshal.mock.calls).toEqual([[0], ["fn"]]); // fn.length, fn.name
  expect(preMarshal.mock.calls).toEqual([[fn, handle]]); // fn.length, fn.name
  expect(vm.typeof(handle)).toBe("function");
  expect(vm.dump(vm.getProp(handle, "length"))).toBe(0);
  expect(vm.dump(vm.getProp(handle, "name"))).toBe("fn");

  const result = vm.unwrapResult(
    vm.callFunction(handle, vm.undefined, vm.newNumber(1), vm.true)
  );

  expect(vm.dump(result)).toBe("hoge");
  expect(innerfn).toBeCalledWith(1, true);
  expect(marshal).toHaveBeenLastCalledWith("hoge");
  expect(unmarshal).toBeCalledTimes(3);
  expect(unmarshal.mock.results[0].value).toBe(undefined); // this
  expect(unmarshal.mock.results[1].value).toBe(1);
  expect(unmarshal.mock.results[2].value).toBe(true);

  handle.dispose();
  eqh.dispose();
  vm.dispose();
});

it("func which has properties", async () => {
  const vm = (await getQuickJS()).createVm();
  const marshal = jest.fn(v =>
    typeof v === "string"
      ? vm.newString(v)
      : typeof v === "number"
      ? vm.newNumber(v)
      : vm.null
  );

  const fn = () => {};
  fn.hoge = "foo";

  const handle = marshalFunction(
    vm,
    fn,
    marshal,
    v => vm.dump(v),
    () => {}
  );
  if (!handle) throw new Error("handle is undefined");

  expect(vm.typeof(handle)).toBe("function");
  expect(vm.dump(vm.getProp(handle, "hoge"))).toBe("foo");
  expect(marshal).toBeCalledWith("foo");

  handle.dispose();
  vm.dispose();
});

it("class", async () => {
  const vm = (await getQuickJS()).createVm();
  const instanceOf = vm.unwrapResult(
    vm.evalCode(`(cls, i) => i instanceof cls`)
  );

  const disposables: QuickJSHandle[] = [];
  const marshal = (v: any) => {
    if (typeof v === "string") return vm.newString(v);
    if (typeof v === "number") return vm.newNumber(v);
    if (typeof v === "object") {
      const obj = vm.newObject();
      disposables.push(obj);
      return obj;
    }
    return vm.null;
  };
  const unmarshal = (v: QuickJSHandle) => vm.dump(v);

  class A {
    a: number;

    constructor(a: number) {
      this.a = a;
    }
  }

  const handle = marshalFunction(vm, A, marshal, unmarshal, () => {});
  if (!handle) throw new Error("handle is undefined");

  const newA = vm.unwrapResult(vm.evalCode(`A => new A(100)`));
  const instance = vm.unwrapResult(vm.callFunction(newA, vm.undefined, handle));

  expect(vm.dump(vm.getProp(handle, "name"))).toBe("A");
  expect(vm.dump(vm.getProp(handle, "length"))).toBe(1);
  expect(
    vm.dump(
      vm.unwrapResult(
        vm.callFunction(instanceOf, vm.undefined, handle, instance)
      )
    )
  ).toBe(true);
  expect(vm.dump(vm.getProp(instance, "a"))).toBe(100);

  disposables.forEach(d => d.dispose());
  instance.dispose();
  newA.dispose();
  handle.dispose();
  instanceOf.dispose();
  vm.dispose();
});

it("class with symbol", async () => {
  const vm = (await getQuickJS()).createVm();

  const disposables: QuickJSHandle[] = [];
  const marshal = (v: any) => {
    if (typeof v === "string") return vm.newString(v);
    if (typeof v === "number") return vm.newNumber(v);
    if (typeof v === "object") {
      const obj = vm.newObject();
      disposables.push(obj);
      return obj;
    }
    return vm.null;
  };

  class A {}

  const sym = vm.unwrapResult(vm.evalCode("Symbol()"));
  const handle = marshalFunction(
    vm,
    A,
    marshal,
    v => vm.dump(v),
    () => {},
    sym
  );
  if (!handle) throw new Error("handle is undefined");

  const actual = vm.getProp(handle, sym);
  expect(vm.typeof(actual)).toBe("function");

  const newA = vm.unwrapResult(vm.evalCode(`A => new A()`));
  // Test that raw functions cannot be used as a class constructor
  expect(() =>
    vm.unwrapResult(vm.callFunction(newA, vm.undefined, actual))
  ).toThrow("not a constructor");

  disposables.forEach(d => d.dispose());
  newA.dispose();
  actual.dispose();
  handle.dispose();
  sym.dispose();
  vm.dispose();
});

it("undefined", async () => {
  const vm = (await getQuickJS()).createVm();
  const f = jest.fn();

  expect(marshalFunction(vm, undefined, f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, null, f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, false, f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, true, f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, 1, f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, [1], f, f, f)).toBe(undefined);
  expect(marshalFunction(vm, { a: 1 }, f, f, f)).toBe(undefined);
  expect(f).toBeCalledTimes(0);

  vm.dispose();
});