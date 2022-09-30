import React from 'react'
import '../css/Factory.css'
import Factory from '../Game/Factory'
import Machine from '../Game/Machine'
import MachineView from './MachineView'
import FactoryCardView from './FactoryCardView'
import IBaseProps from './IBaseProps'

interface IFactoryProps extends IBaseProps {
    factory: Factory
    onSelectedFactory: (factory: Factory) => void
}

const renderMachine = (machine: Machine, index: number): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <MachineView machine={machine} />
        </div>
    )
}

const renderFactoryCard = (factory: Factory, index: number, onClickEnter: () => void): JSX.Element => {
    return (
        <div key={index} className="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 machine-container">
            <FactoryCardView factory={factory} onClickEnter={onClickEnter} />
        </div>
    )
}

const FactoryView = (props: IFactoryProps): JSX.Element => {
    const machines = props.factory.machines.map((machine, i) => renderMachine(machine, i))
    const factories = props.factory.factories.map((factory, i) => renderFactoryCard(factory, i, () => props.onSelectedFactory(factory)))
    return (
        <div>
            <div className="row">
                {machines}
            </div>
            <div className="row">
                {factories}
            </div>
        </div>
    )
}

export default FactoryView
