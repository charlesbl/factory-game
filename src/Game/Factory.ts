import Machine from './Machine'
import Craft from './Craft'
import MachineCraft from './MachineCraft'

export default class Factory {
    machines: Machine[]
    factories: Factory[]

    constructor (machines?: Machine[], factories?: Factory[]) {
        if (machines !== undefined) {
            this.machines = machines
        } else {
            this.machines = []
        }

        if (factories !== undefined) {
            this.factories = factories
        } else {
            this.factories = []
        }
    }

    addSubFactory (): void {
        this.factories.push(new Factory())
    }

    buildMachine (machineCraft: MachineCraft, manual = false): Machine {
        const machine = new Machine(machineCraft.name, machineCraft.outputCraft, manual)
        this.machines.push(machine)
        return machine
    }

    destroyMachine (machine: Machine): void {
        this.machines = this.machines.filter((elem) => {
            return elem !== machine
        })
    }

    getMachinesOfType (machineCraft: Craft): Machine[] {
        return this.machines.filter((machine) => machine.craft.id === machineCraft.id)
    }

    destroy (): void {
        this.factories.forEach((factory) => factory.destroy())
        this.machines.forEach((machine) => this.destroyMachine(machine))
    }
}
